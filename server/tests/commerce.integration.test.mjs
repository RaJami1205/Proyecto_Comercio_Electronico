/** PostgreSQL real EFÍMERO. Opt-in/loopback; jamás Production. Las pruebas confirman fixtures y cortan sesiones de test. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { Database } from '../dist/db/pool.js'
import { withTransaction } from '../dist/db/transaction.js'
import { getDatabaseTestConfig } from '../dist/config/database.js'
import { OrderError } from '../dist/domain/orderError.js'
import { PostgreSQLOrderStore } from '../dist/stores/postgreSQLOrderStore.js'
import { PostgreSQLPaymentStore } from '../dist/stores/postgreSQLPaymentStore.js'
import { PaymentService } from '../dist/services/paymentService.js'
import { orderFixture, owner, paymentRequest, creationContext } from './helpers/commerceFixtures.mjs'

const enabled = process.env.RUN_DATABASE_INTEGRATION_TESTS === '1'
test('CN-58/CN-59 PostgreSQL aislado: Orders + Payment + Recovery', {
  skip: enabled ? false : 'Requiere opt-in, DATABASE_TEST_URL y DATABASE_RUNTIME_TEST_URL de loopback.', timeout: 90000,
}, async t => {
  const adminConfig = getDatabaseTestConfig()
  assert.equal(adminConfig.database, 'cibernova_test', 'Solo la base efímera cibernova_test.')
  assert.equal(adminConfig.user, 'cn_test_admin', 'Solo el administrador efímero de CI.')
  const runtimeConfig = getDatabaseTestConfig({ ...process.env, DATABASE_TEST_URL: process.env.DATABASE_RUNTIME_TEST_URL })
  assert.equal(runtimeConfig.host, adminConfig.host); assert.equal(runtimeConfig.port, adminConfig.port)
  assert.equal(runtimeConfig.database, adminConfig.database); assert.equal(runtimeConfig.user, 'cibernova_app')
  assert.notEqual(adminConfig.user, runtimeConfig.user)
  const admin = new Database(() => ({ ...adminConfig, max: 2 }))
  const runtime = () => new Database(() => ({ ...runtimeConfig, max: 4 }))
  const db = runtime(), secondDb = runtime()
  t.after(async () => { await Promise.all([admin.close(), db.close(), secondDb.close()]) })
  const orders = new PostgreSQLOrderStore(db), otherOrders = new PostgreSQLOrderStore(secondDb)
  const pair = (connection = db, sandbox = { process: async input => ({ result: input.scenario }) }) => {
    const store = new PostgreSQLOrderStore(connection), persistence = new PostgreSQLPaymentStore(store, connection)
    return { store, persistence, service: new PaymentService(store, sandbox, persistence) }
  }
  const create = (store = orders) => store.createOrReplay(creationContext(randomUUID()), async id => orderFixture(id))
  const countAttempts = async id => Number((await admin.query('SELECT count(*) AS value FROM commerce.payment_attempts WHERE order_id = $1', [id])).rows[0].value)

  await t.test('CN-58 concurrencia real, key global, ownership, payload y Replay desde otro Pool', async () => {
    const key = randomUUID(), context = creationContext(key); let builds = 0
    const results = await Promise.all(Array.from({ length: 8 }, (_, index) => (index % 2 ? otherOrders : orders).createOrReplay(context, async id => {
      builds++; await new Promise(resolve => setTimeout(resolve, 40)); return orderFixture(id)
    })))
    assert.equal(builds, 1); assert.equal(new Set(results.map(order => order.id)).size, 1)
    assert.deepEqual(await otherOrders.findByIdempotencyKey(key, owner.id), results[0])
    await assert.rejects(otherOrders.createOrReplay({ ...context, user: { ...owner, id: 'other' }, canonicalPayload: 'different' }, async () => assert.fail()), { status: 404 })
    await assert.rejects(otherOrders.createOrReplay({ ...context, canonicalPayload: 'different' }, async () => assert.fail()), { status: 409 })
    assert.equal((await orders.findById(results[0].id)).totals.subtotal, 99999.995)
  })

  await t.test('CN-58 rollback elimina claim/Order; Retry explícito conserva la key', async () => {
    const key = randomUUID(), context = creationContext(key)
    await assert.rejects(orders.createOrReplay(context, async () => { throw new OrderError(400, 'CHECKOUT_VALIDATION_ERROR', 'Fixture inválido') }), { status: 400 })
    assert.equal((await admin.query('SELECT count(*) AS value FROM commerce.order_creation_requests WHERE idempotency_key = $1', [key])).rows[0].value, '0')
    const order = await otherOrders.createOrReplay(context, async id => orderFixture(id))
    assert.equal((await orders.findByIdempotencyKey(key, owner.id)).id, order.id)
  })

  for (const scenario of ['PAYMENT_APPROVED', 'PAYMENT_DECLINED', 'PAYMENT_ERROR']) {
    await t.test('Payment histórico, Retry y nuevas instancias: ' + scenario, async () => {
      const order = await create(), firstPair = pair()
      const first = await firstPair.service.process(order.id, paymentRequest(scenario), owner.id)
      const restartedDb = runtime()
      try {
        const restarted = pair(restartedDb)
        if (scenario !== 'PAYMENT_APPROVED') await restarted.service.process(order.id, paymentRequest('PAYMENT_APPROVED', 'retry'), owner.id)
        assert.deepEqual(await restarted.service.process(order.id, paymentRequest('PAYMENT_ERROR'), owner.id), first)
        assert.equal((await restarted.persistence.findByKey(order.id, 'attempt', owner.id)).scenario, scenario)
        assert.equal(await countAttempts(order.id), scenario === 'PAYMENT_APPROVED' ? 1 : 2)
        assert.equal((await orders.findById(order.id)).orderStatus, 'CONFIRMED')
        await assert.rejects(restarted.service.process(order.id, paymentRequest('PAYMENT_APPROVED', 'new'), owner.id), { code: 'ORDER_ALREADY_CONFIRMED' })
        await assert.rejects(restarted.service.process(order.id, paymentRequest(), 'other'), { status: 404 })
        assert.deepEqual(first.order.totals, order.totals); assert.deepEqual(first.order.termsAcceptance, order.termsAcceptance)
      } finally { await restartedDb.close() }
    })
  }

  await t.test('NOWAIT real entre Pools: misma key, distinta key, propietario ajeno y Order independiente', async () => {
    const order = await create(), independent = await create()
    let entered, release, executions = 0
    const began = new Promise(resolve => { entered = resolve }), gate = new Promise(resolve => { release = resolve })
    const first = pair(db, { process: async input => { entered(); await gate; return { result: input.scenario } } })
    const concurrent = pair(secondDb, { process: async input => { executions++; return { result: input.scenario } } })
    const pending = first.service.process(order.id, paymentRequest('PAYMENT_DECLINED'), owner.id)
    await began
    try {
      for (const key of ['attempt', 'different']) await assert.rejects(concurrent.service.process(order.id, paymentRequest('PAYMENT_APPROVED', key), owner.id), { status: 409, code: 'PAYMENT_IN_PROGRESS' })
      await assert.rejects(concurrent.service.process(order.id, paymentRequest(), 'other'), { status: 404 })
      assert.equal(executions, 0)
      await concurrent.service.process(independent.id, paymentRequest(), owner.id)
      assert.equal(executions, 1)
    } finally { release(); await pending }
    assert.equal(await countAttempts(order.id), 1)
    assert.equal((await concurrent.service.process(order.id, paymentRequest(), owner.id)).result, 'PAYMENT_DECLINED')
  })

  await t.test('fallo INSERT real y fallo COMMIT diferido revierten estados y Attempt juntos', async () => {
    for (const stage of ['insert', 'commit']) {
      const order = await create()
      const connection = {
        connect: () => db.connect(),
        transaction: (operation, options) => db.transaction(async client => {
          const proxy = new Proxy(client, { get(target, property) {
            if (property !== 'query') { const value = Reflect.get(target, property); return typeof value === 'function' ? value.bind(target) : value }
            return statement => {
              if (stage === 'insert' && statement.text?.startsWith('INSERT INTO commerce.payment_attempts')) {
                const values = [...statement.values]; values[3] = 'INVALID_RESULT'
                return target.query({ ...statement, values })
              }
              return target.query(statement)
            }
          } })
          const result = await operation(proxy)
          if (stage === 'commit') await client.query('INSERT INTO commerce.order_creation_requests VALUES ($1,$2,$3,1,$4,$5)', [randomUUID(), owner.id, 'fixture', randomUUID(), new Date().toISOString()])
          return result
        }, options),
      }
      await assert.rejects(pair(connection).service.process(order.id, paymentRequest(), owner.id), { status: 503 })
      assert.equal(await countAttempts(order.id), 0); assert.equal((await orders.findById(order.id)).paymentStatus, 'PENDING')
    }
  })

  await t.test('COMMIT real seguido de ack perdido se reconcilia por otra conexión; rollback vacío sigue unknown', async () => {
    for (const committed of [true, false]) {
      const order = await create(); let executions = 0, writerPid
      const leases = []
      const connection = {
        connect: async () => { const client = await db.connect(); leases.push(client.processID); return client },
        transaction: (operation, options) => withTransaction({ connect: async () => {
          const client = await db.connect(); writerPid = client.processID
          return new Proxy(client, { get(target, property) {
            if (property !== 'query') { const value = Reflect.get(target, property); return typeof value === 'function' ? value.bind(target) : value }
            return async statement => {
              if ((typeof statement === 'string' ? statement : statement.text) === 'COMMIT') {
                if (committed) await target.query(statement)
                // Se pierde el ack o el envío de COMMIT: el helper real descarta este backend.
                throw Object.assign(new Error('Ack de test interrumpido'), { code: 'ECONNRESET' })
              }
              return target.query(statement)
            }
          } })
        } }, operation, options),
      }
      const payments = pair(connection, { process: async input => { executions++; return { result: input.scenario } } })
      const attempt = payments.service.process(order.id, paymentRequest(), owner.id)
      if (committed) assert.equal((await attempt).result, 'PAYMENT_APPROVED')
      else await assert.rejects(attempt, { status: 503, outcome: 'unknown' })
      assert.equal(executions, 1); assert.equal(leases.length, 2); assert.notEqual(leases[1], writerPid)
      assert.equal(await countAttempts(order.id), committed ? 1 : 0)
    }
  })

  await t.test('sesión interrumpida antes de COMMIT libera lock y permite Retry explícito con misma key', async () => {
    const order = await create(); let backend, entered, release
    const began = new Promise(resolve => { entered = resolve }), gate = new Promise(resolve => { release = resolve })
    const connection = { connect: () => db.connect(), transaction: (operation, options) => db.transaction(client => { backend = client.processID; return operation(client) }, options) }
    const payments = pair(connection, { process: async () => { entered(); await gate; return { result: 'PAYMENT_APPROVED' } } })
    const attempt = payments.service.process(order.id, paymentRequest(), owner.id)
    const rejected = assert.rejects(attempt, { status: 503 })
    await began
    try { assert.equal((await admin.query('SELECT pg_terminate_backend($1) AS stopped', [backend])).rows[0].stopped, true) }
    finally { release() }
    await rejected
    assert.equal(await countAttempts(order.id), 0); assert.equal((await orders.findById(order.id)).paymentStatus, 'PENDING')
    assert.equal((await pair(secondDb).service.process(order.id, paymentRequest(), owner.id)).result, 'PAYMENT_APPROVED')
  })

  await t.test('login runtime real: FOR UPDATE permitido y snapshots/Attempts inmutables', async () => {
    const order = await create()
    assert.equal((await db.query('SELECT current_user AS name')).rows[0].name, 'cibernova_app')
    await db.transaction(async client => { assert.equal((await orders.readForPayment(client, order.id, owner.id, 2000, true)).id, order.id) })
    for (const sql of [
      'UPDATE commerce.orders SET total = 1 WHERE id = $1',
      "UPDATE commerce.payment_attempts SET result = 'PAYMENT_APPROVED' WHERE order_id = $1",
      'DELETE FROM commerce.orders WHERE id = $1',
    ]) await assert.rejects(db.query(sql, [order.id]), { sqlState: '42501' })
  })
})
