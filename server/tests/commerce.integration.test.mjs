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
import { OrderService } from '../dist/services/orderService.js'
import { CURRENT_TERMS_VERSION } from '../dist/domain/termsPolicy.js'
import { orderFixture, owner, paymentRequest, creationContext } from './helpers/commerceFixtures.mjs'

const enabled = process.env.RUN_DATABASE_INTEGRATION_TESTS === '1'
test('CN-58/CN-59/CN-61 PostgreSQL aislado: Orders + Payment + Recovery', {
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

  // Solo catálogo sintético: OrderService y los repositorios utilizan el Runtime PostgreSQL real de CI.
  const v2Buyer = { id: 'owner-v2-business', displayName: 'Comprador B2B ficticio', role: 'B2B',
    company: { id: 'company-v2', name: 'Empresa ficticia' } }
  const v2Product = { objectID: 'p', title: 'Producto V2', image_url: '', price: 59999.995,
    b2b: { available: true, wholesale_price: 49999.9975, min_order_quantity: 2 },
    stock_by_branch: { san_jose: 10, alajuela: 10, cartago: 0, heredia: 4 } }
  const v2Request = key => ({ buyer: orderFixture().buyer, delivery: orderFixture().delivery,
    items: [{ productId: 'p', quantity: 2 }], idempotencyKey: key, branchId: 'san_jose',
    termsAcceptance: { accepted: true, version: CURRENT_TERMS_VERSION } })
  const v2Lookup = async () => structuredClone(v2Product)

  await t.test('CN-61 schema V2 conserva tipos, defaults y round-trip de Orders V1', async () => {
    const columns = (await admin.query(`SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns WHERE table_schema = 'commerce' AND table_name = 'orders'
      AND column_name IN ('contract_version', 'branch_id', 'pricing_type', 'commercial_policy_version')`)).rows
    const byName = new Map(columns.map(column => [column.column_name, column]))
    assert.equal(byName.size, 4, 'CI debe aplicar también la tercera migration de Orders V2.')
    assert.equal(byName.get('contract_version').data_type, 'smallint')
    assert.equal(byName.get('contract_version').is_nullable, 'NO')
    assert.match(byName.get('contract_version').column_default, /^(?:1|'1')(?:::smallint)?$/)
    for (const name of ['branch_id', 'pricing_type', 'commercial_policy_version']) {
      assert.equal(byName.get(name).data_type, 'text')
      assert.equal(byName.get(name).is_nullable, 'YES')
      assert.equal(byName.get(name).column_default, null)
    }
    const order = await create()
    const row = (await db.query('SELECT contract_version, branch_id, pricing_type, commercial_policy_version FROM commerce.orders WHERE id = $1', [order.id])).rows[0]
    assert.deepEqual(row, { contract_version: 1, branch_id: null, pricing_type: null, commercial_policy_version: null })
    assert.deepEqual(await otherOrders.findByIdForOwner(order.id, owner.id), order)
  })

  await t.test('CN-61 B2C/B2B persisten role, Company, branch, Pricing, MOQ, Terms y NUMERIC exacto', async () => {
    const key = randomUUID(), ids = []
    for (const buyer of [{ ...owner, id: 'owner-v2-retail' }, v2Buyer]) {
      const service = new OrderService(orders, v2Lookup)
      const input = v2Request(key)
      const order = await service.createV2(input, buyer)
      ids.push(order.id)
      const raw = (await db.query(`SELECT o.*, r.canonical_version, r.canonical_payload, r.order_id AS request_order_id
        FROM commerce.orders o JOIN commerce.order_creation_requests r ON r.order_id = o.id AND r.owner_user_id = o.owner_user_id
        WHERE r.idempotency_key = $1`, [`${buyer.id}:${key}`])).rows[0]
      assert.equal(raw.contract_version, 2); assert.equal(raw.canonical_version, 2)
      assert.equal(raw.request_order_id, order.id)
      assert.deepEqual(raw.user_snapshot, buyer)
      assert.equal(raw.branch_id, input.branchId)
      assert.equal(raw.pricing_type, buyer.role === 'B2B' ? 'WHOLESALE' : 'RETAIL')
      assert.equal(raw.commercial_policy_version, 'CIBERNOVA-COMMERCIAL-V1')
      assert.deepEqual(raw.items_snapshot, order.items)
      assert.equal(order.items[0].unitPrice, buyer.role === 'B2B' ? v2Product.b2b.wholesale_price : v2Product.price)
      assert.equal(order.items[0].minOrderQuantity, buyer.role === 'B2B' ? 2 : 1)
      for (const field of ['subtotal', 'tax', 'shipping', 'total']) {
        assert.equal(typeof raw[field], 'string'); assert.equal(Number(raw[field]), order.totals[field])
      }
      assert.deepEqual(order.commercial, { userId: buyer.id, customerRole: buyer.role,
        ...(buyer.role === 'B2B' ? { company: buyer.company } : {}), branchId: input.branchId,
        pricingType: raw.pricing_type, policyVersion: raw.commercial_policy_version })
      assert.equal(raw.terms_version, input.termsAcceptance.version)
      assert.equal(raw.terms_accepted_at.toISOString(), order.termsAcceptance.acceptedAt)
      const canonical = JSON.parse(raw.canonical_payload)
      assert.equal(canonical.userId, buyer.id); assert.equal(canonical.branchId, input.branchId)
      assert.deepEqual(await otherOrders.findByIdForOwner(order.id, buyer.id), order)
    }
    assert.notEqual(ids[0], ids[1], 'La misma key externa pertenece a namespaces V2 distintos por usuario.')
  })

  await t.test('CN-61 Replay desde otra instancia conserva snapshot histórico sin reconstrucción comercial', async () => {
    const input = v2Request(randomUUID())
    const order = await new OrderService(orders, v2Lookup).createV2(input, v2Buyer)
    const changedBuyer = { ...v2Buyer, displayName: 'Nombre posterior', company: { id: 'other-company', name: 'Empresa posterior' } }
    const restarted = new OrderService(new PostgreSQLOrderStore(secondDb), async () => assert.fail('Replay no consulta Pricing/Inventory actuales.'))
    assert.deepEqual(await restarted.createV2(input, changedBuyer), order)
    assert.deepEqual((await otherOrders.findByIdempotencyKey(`${v2Buyer.id}:${input.idempotencyKey}`, v2Buyer.id)).commercial.company, v2Buyer.company)
  })

  await t.test('CN-61 cambio de sucursal o payload conserva 409 sin catálogo y ownership conserva 404', async () => {
    const input = v2Request(randomUUID())
    const order = await new OrderService(orders, v2Lookup).createV2(input, v2Buyer)
    const service = new OrderService(otherOrders, async () => assert.fail('Un conflicto no reconstruye la Order.'))
    for (const patch of [{ branchId: 'alajuela' }, { items: [{ productId: 'p', quantity: 3 }] },
      { buyer: { ...input.buyer, fullName: 'Otro comprador' } }]) {
      await assert.rejects(service.createV2({ ...input, ...patch }, v2Buyer), { status: 409 })
    }
    await assert.rejects(service.findById(order.id, owner.id), { status: 404 })
    assert.deepEqual(await otherOrders.findByIdForOwner(order.id, v2Buyer.id), order)
  })

  await t.test('CN-63 Order Ownership con PostgreSQL autoritativo: propietario, ajeno, ADMIN, Payment y Replay', async () => {
    const order = await new OrderService(orders, v2Lookup).createV2(v2Request(randomUUID()), v2Buyer)
    const reader = new OrderService(new PostgreSQLOrderStore(secondDb), async () => assert.fail('La consulta no usa catálogo ni Algolia.'))
    assert.deepEqual(await reader.findAuthorized(order.id, v2Buyer), order)
    for (const intruder of [owner, { ...v2Buyer, id: 'other-business' }]) {
      await assert.rejects(reader.findAuthorized(order.id, intruder), { status: 404, code: 'ORDER_NOT_FOUND' })
    }
    const adminUser = { id: 'admin-ci', displayName: 'Administración ficticia', role: 'ADMIN' }
    assert.deepEqual(await reader.findAuthorized(order.id, adminUser), order)
    await assert.rejects(reader.findAuthorized(randomUUID(), adminUser), { status: 404, code: 'ORDER_NOT_FOUND' })
    const { service } = pair(secondDb)
    await assert.rejects(service.process(order.id, paymentRequest('PAYMENT_DECLINED', 'cn63'), owner.id), { status: 404 })
    assert.equal(await countAttempts(order.id), 0)
    const declined = await service.process(order.id, paymentRequest('PAYMENT_DECLINED', 'cn63'), v2Buyer.id)
    await assert.rejects(service.process(order.id, paymentRequest('PAYMENT_DECLINED', 'cn63'), owner.id), { status: 404 })
    assert.deepEqual(await service.process(order.id, paymentRequest('PAYMENT_DECLINED', 'cn63'), v2Buyer.id), declined)
    assert.equal(await countAttempts(order.id), 1)
  })

  await t.test('CN-61 fallo comercial y COMMIT diferido revierten Order V2 e Idempotency juntos', async () => {
    const input = v2Request(randomUUID()), key = `${v2Buyer.id}:${input.idempotencyKey}`
    const service = new OrderService(orders, v2Lookup)
    await assert.rejects(service.createV2({ ...input, items: [{ productId: 'p', quantity: 11 }] }, v2Buyer), { code: 'INSUFFICIENT_INVENTORY' })
    assert.equal((await admin.query('SELECT count(*) AS value FROM commerce.order_creation_requests WHERE idempotency_key = $1', [key])).rows[0].value, '0')

    const deferredKey = randomUUID()
    let candidateId, builds = 0
    const connection = {
      connect: () => db.connect(),
      transaction: (operation, options) => db.transaction(async client => {
        const result = await operation(client)
        candidateId = result.id
        // FK diferible real: provoca un rechazo de COMMIT después de insertar la Order y su claim.
        await client.query(`INSERT INTO commerce.order_creation_requests
          (idempotency_key, owner_user_id, canonical_payload, canonical_version, order_id, created_at)
          VALUES ($1, $2, $3, 2, $4, $5)`, [deferredKey, v2Buyer.id, 'fixture-v2', randomUUID(), new Date().toISOString()])
        return result
      }, options),
    }
    const failing = new OrderService(new PostgreSQLOrderStore(connection), async () => { builds++; return v2Lookup() })
    await assert.rejects(failing.createV2(input, v2Buyer), { status: 503 })
    assert.equal(typeof candidateId, 'string'); assert.equal(builds, 1)
    assert.equal((await admin.query('SELECT count(*) AS value FROM commerce.orders WHERE id = $1', [candidateId])).rows[0].value, '0')
    assert.equal((await admin.query('SELECT count(*) AS value FROM commerce.order_creation_requests WHERE idempotency_key = ANY($1::text[])', [[key, deferredKey]])).rows[0].value, '0')
    const retried = await service.createV2(input, v2Buyer)
    assert.equal((await otherOrders.findByIdempotencyKey(key, v2Buyer.id)).id, retried.id)
  })

  await t.test('CN-61 concurrencia entre Pools comparte una sola Order V2 y construcción comercial', async () => {
    const input = v2Request(randomUUID())
    let builds = 0
    const results = await Promise.all(Array.from({ length: 8 }, (_, index) =>
      new OrderService(index % 2 ? otherOrders : orders, async () => {
        builds++; await new Promise(resolve => setTimeout(resolve, 30)); return v2Lookup()
      }).createV2(input, v2Buyer)))
    assert.equal(builds, 1)
    assert.equal(new Set(results.map(order => order.id)).size, 1)
    for (const result of results) assert.deepEqual(result, results[0])
    assert.equal((await admin.query('SELECT count(*) AS value FROM commerce.order_creation_requests WHERE idempotency_key = $1', [`${v2Buyer.id}:${input.idempotencyKey}`])).rows[0].value, '1')
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
