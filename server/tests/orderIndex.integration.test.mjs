/** CN-65 con PostgreSQL real EFÍMERO: revisiones, leases y Payment; Algolia se sustituye por un escritor en memoria. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { Database } from '../dist/db/pool.js'
import { getDatabaseTestConfig } from '../dist/config/database.js'
import { PostgreSQLOrderStore } from '../dist/stores/postgreSQLOrderStore.js'
import { PostgreSQLPaymentStore } from '../dist/stores/postgreSQLPaymentStore.js'
import { PostgreSQLOrderIndexStore } from '../dist/stores/postgreSQLOrderIndexStore.js'
import { PaymentService } from '../dist/services/paymentService.js'
import { OrderIndexSyncService } from '../dist/services/orderIndexSyncService.js'
import { orderFixture, owner, paymentRequest, creationContext } from './helpers/commerceFixtures.mjs'

const business = { id: 'owner-cn65-b2b', displayName: 'Compras ficticias', role: 'B2B', company: { id: 'company-cn65', name: 'Empresa ficticia' } }
/** Order V2 B2B sintética con contexto comercial completo. */
function businessOrder(id) {
  const base = orderFixture(id)
  return { ...base, items: base.items.map(item => ({ ...item, minOrderQuantity: 1 })), contractVersion: 2,
    commercial: { userId: business.id, customerRole: 'B2B', company: business.company, branchId: 'heredia',
      pricingType: 'WHOLESALE', policyVersion: 'CIBERNOVA-COMMERCIAL-V1' } }
}

/** Escritor en memoria con la semántica de addOrUpdateObject: reemplaza por objectID. */
function memoryWriter() {
  const records = new Map()
  let failures = 0
  const writer = {
    saves: 0,
    failNext(count = 1) { failures = count },
    async save(record) {
      if (failures > 0) { failures--; throw Object.assign(new Error('PRIVATE upstream detail'), { status: 503 }) }
      writer.saves++
      records.set(record.objectID, structuredClone(record))
    },
    async readVersions(ids) { return new Map(ids.filter(id => records.has(id)).map(id => [id, records.get(id).indexVersion])) },
  }
  return { writer, records }
}

const enabled = process.env.RUN_DATABASE_INTEGRATION_TESTS === '1'
test('CN-65 PostgreSQL aislado: proyección orders, revisiones y Recovery', {
  skip: enabled ? false : 'Requiere opt-in, DATABASE_TEST_URL y DATABASE_RUNTIME_TEST_URL de loopback.', timeout: 60000,
}, async t => {
  const adminConfig = getDatabaseTestConfig()
  assert.equal(adminConfig.database, 'cibernova_test', 'Solo la base efímera cibernova_test.')
  const runtimeConfig = getDatabaseTestConfig({ ...process.env, DATABASE_TEST_URL: process.env.DATABASE_RUNTIME_TEST_URL })
  assert.equal(runtimeConfig.user, 'cibernova_app')
  const admin = new Database(() => ({ ...adminConfig, max: 2 }))
  const db = new Database(() => ({ ...runtimeConfig, max: 4 }))
  t.after(async () => { await Promise.all([admin.close(), db.close()]) })

  const orders = new PostgreSQLOrderStore(db)
  const indexStore = new PostgreSQLOrderIndexStore(db)
  const payments = new PaymentService(orders, { process: async input => ({ result: input.scenario }) }, new PostgreSQLPaymentStore(orders, db), { notify() {} })
  const state = async id => (await admin.query(`SELECT index_version, indexed_version, index_failure_count, index_last_error,
    index_lease_token, order_status, payment_status, total::text AS total FROM commerce.orders WHERE id = $1`, [id])).rows[0]
  const createB2C = () => orders.createOrReplay(creationContext(randomUUID()), async id => orderFixture(id))
  const service = (writer, options = {}) => new OrderIndexSyncService(indexStore, writer, { retryDelaysMs: [], log() {}, ...options })

  await t.test('una Order nueva queda pendiente y se indexa una sola vez con su id como objectID', async () => {
    const order = await createB2C()
    assert.deepEqual(await state(order.id), { index_version: 1, indexed_version: 0, index_failure_count: 0, index_last_error: null,
      index_lease_token: null, order_status: 'PENDING', payment_status: 'PENDING', total: String(order.totals.total) })
    const { writer, records } = memoryWriter()
    assert.equal(await service(writer).syncOrder(order.id), 'synced')
    assert.equal(await service(writer).syncOrder(order.id), 'up-to-date')
    assert.equal(writer.saves, 1)
    const record = records.get(order.id)
    assert.deepEqual(record, { objectID: order.id, orderNumber: order.orderNumber, userId: owner.id, customerRole: 'B2C', branchId: null,
      createdAt: order.createdAt, createdAtTimestamp: Math.floor(Date.parse(order.createdAt) / 1000), orderStatus: 'PENDING',
      paymentStatus: 'PENDING', total: order.totals.total, currency: 'CRC', indexVersion: 1, contractVersion: 1 })
    assert.equal((await state(order.id)).indexed_version, 1)
    assert.equal(await service(writer).syncOrder('missing-' + randomUUID()), 'not-found')
  })

  await t.test('B2B V2 conserva rol, sucursal y Company sin datos personales', async () => {
    const order = await orders.createOrReplay({ user: business, idempotencyKey: randomUUID(), canonicalVersion: 2, canonicalPayload: 'cn65-v2' },
      async id => businessOrder(id))
    const { writer, records } = memoryWriter()
    assert.equal(await service(writer).syncOrder(order.id), 'synced')
    const record = records.get(order.id)
    assert.equal(record.customerRole, 'B2B'); assert.equal(record.branchId, 'heredia'); assert.equal(record.contractVersion, 2)
    assert.deepEqual(record.company, business.company)
    assert.ok(!JSON.stringify(record).includes('test@example.com') && !('buyer' in record) && !('delivery' in record) && !('items' in record))
  })

  await t.test('DECLINED, ERROR y APPROVED crean revisiones; Replay no las incrementa', async () => {
    const order = await createB2C()
    const { writer, records } = memoryWriter()
    const sync = service(writer)
    assert.equal(await sync.syncOrder(order.id), 'synced')
    for (const [scenario, key, version, orderStatus, paymentStatus] of [
      ['PAYMENT_DECLINED', 'declined', 2, 'PENDING', 'DECLINED'],
      ['PAYMENT_ERROR', 'error', 3, 'PENDING', 'ERROR'],
      ['PAYMENT_APPROVED', 'approved', 4, 'CONFIRMED', 'APPROVED'],
    ]) {
      await payments.process(order.id, paymentRequest(scenario, key), owner.id)
      assert.equal((await state(order.id)).index_version, version)
      assert.equal(await sync.syncOrder(order.id), 'synced')
      assert.equal(records.get(order.id).indexVersion, version)
      assert.equal(records.get(order.id).orderStatus, orderStatus)
      assert.equal(records.get(order.id).paymentStatus, paymentStatus)
    }
    await payments.process(order.id, paymentRequest('PAYMENT_APPROVED', 'approved'), owner.id)
    assert.equal((await state(order.id)).index_version, 4)
    assert.equal(records.size, 1)
  })

  await t.test('un fallo de Algolia conserva la Order, registra la categoría y Reconciliation la recupera', async () => {
    const order = await createB2C()
    const { writer, records } = memoryWriter()
    writer.failNext()
    await assert.rejects(service(writer).syncOrder(order.id), { name: 'OrderIndexError', kind: 'unavailable' })
    const failed = await state(order.id)
    assert.equal(failed.indexed_version, 0); assert.equal(failed.index_failure_count, 1)
    assert.equal(failed.index_last_error, 'unavailable'); assert.equal(failed.index_lease_token, null)
    assert.equal(failed.order_status, 'PENDING')
    assert.ok((await orders.findById(order.id)))

    const dryRun = await service(writer).reconcile({ limit: 100000, dryRun: true })
    assert.ok(dryRun.pending >= 1)
    assert.equal(records.size, 0)
    assert.equal((await state(order.id)).indexed_version, 0)

    // Un servicio nuevo simula el reinicio del Server: el estado pendiente vive en PostgreSQL.
    const report = await service(writer).reconcile({ limit: 100000, dryRun: false })
    assert.ok(report.synced >= 1)
    assert.equal(records.get(order.id).indexVersion, 1)
    assert.deepEqual([(await state(order.id)).indexed_version, (await state(order.id)).index_failure_count], [1, 0])
  })

  await t.test('leases excluyen escrituras concurrentes y expiran tras una caída', async () => {
    const order = await createB2C()
    const first = await indexStore.claim(order.id, 60000)
    assert.equal(first.status, 'claimed')
    assert.equal((await indexStore.claim(order.id, 60000)).status, 'busy')
    // Lease vencido: equivale a un proceso detenido durante la sincronización.
    await admin.query("UPDATE commerce.orders SET index_lease_expires_at = now() - interval '1 second' WHERE id = $1", [order.id])
    const second = await indexStore.claim(order.id, 60000)
    assert.equal(second.status, 'claimed')
    assert.deepEqual(await indexStore.complete(order.id, first.token, 1), { pending: true })
    assert.equal((await state(order.id)).indexed_version, 0)
    assert.deepEqual(await indexStore.complete(order.id, second.token, 1), { pending: false })
  })

  await t.test('una revisión obsoleta no sobrescribe el estado reciente ni se marca como vigente', async () => {
    const order = await createB2C()
    const claim = await indexStore.claim(order.id, 60000)
    assert.equal(claim.source.indexVersion, 1)
    await payments.process(order.id, paymentRequest('PAYMENT_APPROVED', 'during-sync'), owner.id)
    assert.deepEqual(await indexStore.complete(order.id, claim.token, 1), { pending: true })
    assert.deepEqual([(await state(order.id)).index_version, (await state(order.id)).indexed_version], [2, 1])
    const { writer, records } = memoryWriter()
    assert.equal(await service(writer).syncOrder(order.id), 'synced')
    assert.equal(records.get(order.id).paymentStatus, 'APPROVED')
    const late = await admin.query('UPDATE commerce.orders SET indexed_version = 1 WHERE id = $1 AND indexed_version < 1 RETURNING id', [order.id])
    assert.equal(late.rows.length, 0)
  })

  await t.test('verifyRemote repara Orders ausentes en Algolia', async () => {
    const order = await createB2C()
    const indexed = memoryWriter()
    assert.equal(await service(indexed.writer).syncOrder(order.id), 'synced')
    const empty = memoryWriter()
    const dry = await service(empty.writer).verifyRemote({ limit: 100000, dryRun: true })
    assert.ok(dry.drift >= 1)
    assert.equal((await state(order.id)).indexed_version, 1)
    const repaired = await service(empty.writer).verifyRemote({ limit: 100000, dryRun: false })
    assert.ok(repaired.repaired >= 1)
    assert.equal(empty.records.get(order.id).indexVersion, 1)
  })

  await t.test('el runtime solo puede escribir las columnas de indexación permitidas', async () => {
    const order = await createB2C()
    await assert.rejects(db.transaction(client => client.query('UPDATE commerce.orders SET total = 1 WHERE id = $1', [order.id])), { kind: 'transaction', sqlState: '42501' })
    await assert.rejects(admin.query('UPDATE commerce.orders SET indexed_version = 5 WHERE id = $1', [order.id]), { sqlState: '23514' })
  })
})
