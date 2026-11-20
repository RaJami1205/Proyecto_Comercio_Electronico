import './helpers/postgresIntegrationIsolation.mjs'
/** CN-66 con PostgreSQL real EFÍMERO: listado global, filtros SQL, búsqueda por IDs y pendientes de indexación. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { Database } from '../dist/db/pool.js'
import { getDatabaseTestConfig } from '../dist/config/database.js'
import { PostgreSQLOrderStore } from '../dist/stores/postgreSQLOrderStore.js'
import { AdminOrderService } from '../dist/services/adminOrderService.js'
import { orderFixture } from './helpers/commerceFixtures.mjs'
import { guardIntegrationDatabase, verifyIntegrationDatabases } from './helpers/postgresIntegrationHarness.mjs'

const enabled = process.env.RUN_DATABASE_INTEGRATION_TESTS === '1'
test('CN-66 PostgreSQL aislado: consulta administrativa global Read-Only', {
  skip: enabled ? false : 'Requiere opt-in, DATABASE_TEST_URL y DATABASE_RUNTIME_TEST_URL de loopback.', timeout: 60000,
}, async t => {
  const adminConfig = getDatabaseTestConfig()
  assert.equal(adminConfig.database, 'cibernova_test', 'Solo la base efímera cibernova_test.')
  const runtimeConfig = getDatabaseTestConfig({ ...process.env, DATABASE_TEST_URL: process.env.DATABASE_RUNTIME_TEST_URL })
  assert.equal(runtimeConfig.user, 'cibernova_app')
  const admin = guardIntegrationDatabase(new Database(() => ({ ...adminConfig, max: 2 })), 'admin')
  const db = guardIntegrationDatabase(new Database(() => ({ ...runtimeConfig, max: 3 })), 'runtime')
  t.after(async () => { await Promise.all([admin.close(), db.close()]) })
  await verifyIntegrationDatabases(admin, db)
  const store = new PostgreSQLOrderStore(db)
  const service = new AdminOrderService(store)

  // Prefijo único: la base efímera puede contener Orders de otras suites.
  const run = randomUUID().slice(0, 8)
  const b2c = { id: 'cn66-b2c-' + run, displayName: 'Cliente CN-66', role: 'B2C' }
  const b2b = { id: 'cn66-b2b-' + run, displayName: 'Compras CN-66', role: 'B2B', company: { id: 'co-' + run, name: 'Empresa CN-66' } }
  const v2 = (id, user, branchId, createdAt, patch = {}) => {
    const base = orderFixture(id)
    return { ...base, createdAt, termsAcceptance: { ...base.termsAcceptance, acceptedAt: createdAt }, contractVersion: 2,
      items: base.items.map(item => ({ ...item, minOrderQuantity: 1 })),
      commercial: { userId: user.id, customerRole: user.role, ...(user.company ? { company: user.company } : {}), branchId,
        pricingType: user.role === 'B2B' ? 'WHOLESALE' : 'RETAIL', policyVersion: 'CIBERNOVA-COMMERCIAL-V1' }, ...patch }
  }
  const create = (user, version, build) => store.createOrReplay({ idempotencyKey: randomUUID(), canonicalPayload: 'cn66', canonicalVersion: version, user }, async id => build(id))
  const legacy = await create(b2c, 1, id => ({ ...orderFixture(id), createdAt: '2026-11-01T10:00:00.000Z' }))
  const b2cOrder = await create(b2c, 2, id => v2(id, b2c, 'san_jose', '2026-11-02T10:00:00.000Z'))
  const b2bOrder = await create(b2b, 2, id => v2(id, b2b, 'heredia', '2026-11-03T10:00:00.000Z'))

  await t.test('filtros SQL por propietario, rol, sucursal y número con identidad histórica y orden por fecha', async () => {
    const page = await service.list({ userId: b2c.id })
    assert.deepEqual(page.orders.map(order => order.id), [b2cOrder.id, legacy.id])
    assert.equal(page.source, 'postgresql')
    assert.equal(page.total, 2)
    assert.deepEqual([page.orders[1].contractVersion, page.orders[1].customerRole, page.orders[1].branchId, page.orders[1].displayName], [1, 'B2C', null, 'Cliente CN-66'])
    const business = await service.list({ userId: b2b.id, customerRole: 'B2B', branchId: 'heredia' })
    assert.deepEqual(business.orders.map(order => [order.id, order.company]), [[b2bOrder.id, b2b.company]])
    assert.deepEqual((await service.list({ orderNumber: b2bOrder.orderNumber.toLowerCase() })).orders.map(order => order.id), [b2bOrder.id])
    assert.deepEqual((await service.list({ userId: b2c.id, sort: 'oldest' })).orders.map(order => order.id), [legacy.id, b2cOrder.id])
    const paged = await service.list({ userId: b2c.id, pageSize: '1', page: '2' })
    assert.deepEqual([paged.orders.map(order => order.id), paged.hasMore, paged.total], [[legacy.id], false, 2])
  })

  await t.test('las Orders pendientes de indexar aparecen en el listado y se cuentan', async () => {
    const pending = Number((await admin.query('SELECT count(*) AS value FROM commerce.orders WHERE indexed_version < index_version')).rows[0].value)
    assert.ok(pending >= 3)
    const page = await service.list({ userId: b2b.id })
    assert.equal(page.pendingIndexOrders, pending)
    assert.deepEqual(page.orders.map(order => order.id), [b2bOrder.id])
  })

  await t.test('findEntriesByIds conserva el orden recibido, omite inexistentes y no modifica filas', async () => {
    const before = (await admin.query('SELECT id, order_status, payment_status, updated_at, index_version FROM commerce.orders WHERE id = ANY($1::text[]) ORDER BY id',
      [[legacy.id, b2bOrder.id]])).rows
    const entries = await store.findEntriesByIds([b2bOrder.id, 'missing-' + run, legacy.id])
    assert.deepEqual(entries.map(entry => entry.order.id), [b2bOrder.id, legacy.id])
    assert.deepEqual(entries[0].owner, { userId: b2b.id, displayName: 'Compras CN-66', customerRole: 'B2B', company: b2b.company })
    const after = (await admin.query('SELECT id, order_status, payment_status, updated_at, index_version FROM commerce.orders WHERE id = ANY($1::text[]) ORDER BY id',
      [[legacy.id, b2bOrder.id]])).rows
    assert.deepEqual(after, before)
  })
})
