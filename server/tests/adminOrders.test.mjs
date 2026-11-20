/** CN-66: consulta administrativa global de Orders con app, RBAC y store reales (In-Memory), sin Algolia ni PostgreSQL. */
import test from 'node:test'
import assert from 'node:assert/strict'
import app from '../dist/app.js'
import { userService } from '../dist/services/userService.js'
import { commerceStores } from '../dist/stores/commerceStores.js'
import { paymentService } from '../dist/services/paymentService.js'
import { AdminOrderService } from '../dist/services/adminOrderService.js'
import { InMemoryOrderStore } from '../dist/stores/orderStore.js'
import { parseAdminOrderQuery } from '../dist/domain/adminOrderQuery.js'
import { orderFixture } from './helpers/commerceFixtures.mjs'

const users = [
  { objectID: 'qa-admin', displayName: 'Administración QA', role: 'ADMIN', enabled: true },
  { objectID: 'qa-b2c', displayName: 'Cliente QA', role: 'B2C', enabled: true },
  { objectID: 'qa-b2c-2', displayName: 'Otra persona QA', role: 'B2C', enabled: true },
  { objectID: 'qa-b2b', displayName: 'Compras QA', role: 'B2B', enabled: true, company: { id: 'qa-company', name: 'Distribuidora QA' } },
  { objectID: 'qa-disabled', displayName: 'Deshabilitada QA', role: 'B2C', enabled: false },
]
const resolved = id => { const { objectID, enabled: _enabled, ...user } = users.find(record => record.objectID === id); return { id: objectID, ...user } }

/** Order V2 sintética con contexto comercial y fecha controlada. */
function v2Order(id, user, branchId, createdAt, patch = {}) {
  const base = orderFixture(id)
  return { ...base, createdAt, termsAcceptance: { ...base.termsAcceptance, acceptedAt: createdAt }, contractVersion: 2,
    commercial: { userId: user.id, customerRole: user.role, ...(user.company ? { company: user.company } : {}), branchId,
      pricingType: user.role === 'B2B' ? 'WHOLESALE' : 'RETAIL', policyVersion: 'CIBERNOVA-COMMERCIAL-V1' }, ...patch }
}

/** Crea Orders reales mediante createOrReplay del store activo: propietario, V1/V2 y fechas distintas. */
async function seed(store) {
  const create = (key, user, version, build) => store.createOrReplay({ idempotencyKey: key, canonicalPayload: key, canonicalVersion: version, user }, async id => build(id))
  const b2c = resolved('qa-b2c'), other = resolved('qa-b2c-2'), b2b = resolved('qa-b2b')
  const orders = {
    legacy: await create('legacy', b2c, 1, id => ({ ...orderFixture(id), createdAt: '2026-11-01T10:00:00.000Z' })),
    b2cSanJose: await create('b2c-sj', b2c, 2, id => v2Order(id, b2c, 'san_jose', '2026-11-05T10:00:00.000Z')),
    b2bHeredia: await create('b2b-he', b2b, 2, id => v2Order(id, b2b, 'heredia', '2026-11-07T10:00:00.000Z')),
    otherCartago: await create('other-ca', other, 2, id => v2Order(id, other, 'cartago', '2026-11-03T10:00:00.000Z')),
    b2bAlajuela: await create('b2b-al', b2b, 2, id => v2Order(id, b2b, 'alajuela', '2026-11-09T10:00:00.000Z',
      { orderStatus: 'CONFIRMED', paymentStatus: 'APPROVED' })),
  }
  return orders
}

const seeded = await seed(commerceStores.orders)

async function http(t) {
  t.mock.method(userService.directory, 'find', async id => users.find(record => record.objectID === id))
  t.mock.method(userService.directory, 'list', async () => users)
  const server = app.listen(0, '127.0.0.1')
  await new Promise(resolve => server.once('listening', resolve))
  t.after(() => new Promise(resolve => server.close(resolve)))
  const base = 'http://127.0.0.1:' + server.address().port
  return async (path, userId = 'qa-admin', init = {}) => {
    const response = await fetch(base + path, { ...init, headers: { ...(userId ? { 'X-CiberNova-User-Id': userId } : {}), ...init.headers } })
    return { status: response.status, body: await response.json().catch(() => null) }
  }
}

test('RBAC: solo ADMIN consulta Orders globales; compradores, sin Session e identidades inválidas son rechazados', async t => {
  const get = await http(t)
  assert.equal((await get('/api/v2/admin/orders')).status, 200)
  for (const [userId, status, code] of [['qa-b2c', 403, 'FORBIDDEN'], ['qa-b2b', 403, 'FORBIDDEN'], [null, 401, 'IDENTITY_REQUIRED'],
    ['qa-missing', 404, 'USER_NOT_FOUND'], ['qa-disabled', 403, 'USER_DISABLED']]) {
    const response = await get('/api/v2/admin/orders', userId)
    assert.equal(response.status, status, String(userId))
    assert.equal(response.body.error.code, code)
    assert.ok(!('orders' in response.body), 'Sin datos administrativos para identidades no autorizadas')
  }
})

test('listado global: compradores B2C/B2B, empresa, sucursal, importes y estados, del más reciente al más antiguo', async t => {
  const get = await http(t)
  const { status, body } = await get('/api/v2/admin/orders')
  assert.equal(status, 200)
  assert.deepEqual(body.orders.map(order => order.id), [seeded.b2bAlajuela.id, seeded.b2bHeredia.id, seeded.b2cSanJose.id, seeded.otherCartago.id, seeded.legacy.id])
  assert.deepEqual([body.page, body.pageSize, body.total, body.hasMore, body.source, body.pendingIndexOrders], [1, 20, 5, false, 'postgresql', null])
  const b2b = body.orders[0]
  assert.deepEqual(b2b, { id: seeded.b2bAlajuela.id, orderNumber: seeded.b2bAlajuela.orderNumber, createdAt: '2026-11-09T10:00:00.000Z', contractVersion: 2,
    userId: 'qa-b2b', displayName: 'Compras QA', customerRole: 'B2B', company: { id: 'qa-company', name: 'Distribuidora QA' }, branchId: 'alajuela',
    total: seeded.b2bAlajuela.totals.total, currency: 'CRC', orderStatus: 'CONFIRMED', paymentStatus: 'APPROVED' })
  const legacy = body.orders.at(-1)
  assert.deepEqual([legacy.contractVersion, legacy.customerRole, legacy.branchId, legacy.company, legacy.userId], [1, 'B2C', null, null, 'qa-b2c'])
  for (const forbidden of ['buyer', 'delivery', 'items', 'termsAcceptance', 'test@example.com']) assert.ok(!JSON.stringify(body).includes(forbidden), forbidden)
  const oldest = (await get('/api/v2/admin/orders?sort=oldest')).body.orders.map(order => order.id)
  assert.deepEqual(oldest, [seeded.legacy.id, seeded.otherCartago.id, seeded.b2cSanJose.id, seeded.b2bHeredia.id, seeded.b2bAlajuela.id])
})

test('filtros combinables por rol, sucursal, estados, usuario, número e ID', async t => {
  const get = await http(t)
  const ids = async query => (await get('/api/v2/admin/orders?' + query)).body.orders.map(order => order.id)
  assert.deepEqual(await ids('customerRole=B2B'), [seeded.b2bAlajuela.id, seeded.b2bHeredia.id])
  assert.deepEqual(await ids('customerRole=B2C&branchId=cartago'), [seeded.otherCartago.id])
  assert.deepEqual(await ids('branchId=heredia'), [seeded.b2bHeredia.id])
  assert.deepEqual(await ids('orderStatus=CONFIRMED&paymentStatus=APPROVED'), [seeded.b2bAlajuela.id])
  assert.deepEqual(await ids('orderStatus=PENDING&customerRole=B2B'), [seeded.b2bHeredia.id])
  assert.deepEqual(await ids('userId=qa-b2c'), [seeded.b2cSanJose.id, seeded.legacy.id])
  assert.deepEqual(await ids('orderNumber=' + seeded.otherCartago.orderNumber.toLowerCase()), [seeded.otherCartago.id])
  assert.deepEqual(await ids('orderId=' + seeded.legacy.id), [seeded.legacy.id])
  assert.deepEqual(await ids('paymentStatus=DECLINED'), [])
})

test('paginación con total y hasMore; filtros inválidos responden INVALID_ORDER_FILTER', async t => {
  const get = await http(t)
  const first = (await get('/api/v2/admin/orders?pageSize=2')).body
  const third = (await get('/api/v2/admin/orders?pageSize=2&page=3')).body
  assert.deepEqual([first.orders.length, first.total, first.hasMore], [2, 5, true])
  assert.deepEqual([third.orders.length, third.hasMore, third.page], [1, false, 3])
  const seen = new Set()
  for (let page = 1; page <= 3; page++) for (const order of (await get('/api/v2/admin/orders?pageSize=2&page=' + page)).body.orders) seen.add(order.id)
  assert.equal(seen.size, 5)
  for (const query of ['customerRole=ADMIN', 'branchId=limon', 'orderStatus=CANCELLED', 'paymentStatus=REFUNDED', 'page=0', 'pageSize=51',
    'sort=price', 'userId=bad%20id', 'orderNumber=CN%20X', 'page=1&page=2', 'q=' + 'x'.repeat(81)]) {
    const response = await get('/api/v2/admin/orders?' + query)
    assert.equal(response.status, 400, query)
    assert.equal(response.body.error.code, 'INVALID_ORDER_FILTER', query)
  }
  assert.deepEqual(parseAdminOrderQuery({}), { q: '', filters: {}, sort: 'newest', page: 1, pageSize: 20, offset: 0 })
})

test('detalle: ADMIN reutiliza GET /api/v2/orders/:id con el snapshot histórico; compradores no ven Orders ajenas', async t => {
  const get = await http(t)
  const detail = await get('/api/v2/orders/' + seeded.b2bHeredia.id)
  assert.equal(detail.status, 200)
  assert.deepEqual(detail.body, seeded.b2bHeredia)
  assert.equal((await get('/api/v2/orders/missing')).body.error.code, 'ORDER_NOT_FOUND')
  assert.equal((await get('/api/v2/orders/' + seeded.b2bHeredia.id, 'qa-b2c')).status, 404)
  // Compatibilidad con Order History: el comprador sigue viendo solo lo propio.
  const mine = (await get('/api/v2/orders/mine', 'qa-b2c')).body
  assert.deepEqual(mine.orders.map(order => order.id), [seeded.b2cSanJose.id, seeded.legacy.id])
  assert.equal((await get('/api/v2/orders/mine')).status, 403)
})

test('Read-Only: sin rutas de escritura y sin cambios en Orders, Payment ni Idempotency', async t => {
  const get = await http(t)
  const before = structuredClone((await get('/api/v2/admin/orders')).body)
  const process = t.mock.method(paymentService.sandbox, 'process', async () => { throw new Error('No debe procesar pagos') })
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    const response = await get('/api/v2/admin/orders', 'qa-admin', { method, headers: { 'Content-Type': 'application/json' }, body: '{}' })
    assert.equal(response.status, 404, method)
  }
  // ADMIN tampoco paga mediante las rutas comerciales existentes.
  const payment = await get('/api/v2/orders/' + seeded.b2bHeredia.id + '/payment', 'qa-admin', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ scenario: 'PAYMENT_APPROVED', idempotencyKey: 'admin-attempt' }) })
  assert.notEqual(payment.status, 200)
  assert.equal(process.mock.callCount(), 0)
  assert.deepEqual((await get('/api/v2/admin/orders')).body, before)
  assert.equal((await commerceStores.orders.findByIdempotencyKey('b2b-he', 'qa-b2b')).id, seeded.b2bHeredia.id)
})

test('fallo de persistencia: 503 ORDER_QUERY_UNAVAILABLE sin detalles internos', async t => {
  const store = new InMemoryOrderStore()
  t.mock.method(store, 'listAll', async () => { throw new Error('PRIVATE connection string') })
  await assert.rejects(new AdminOrderService(store).list({}), error => error.status === 503 && error.code === 'ORDER_QUERY_UNAVAILABLE' && !error.message.includes('PRIVATE'))
  const get = await http(t)
  t.mock.method(commerceStores.orders, 'listAll', async () => { throw new Error('PRIVATE connection string') })
  const response = await get('/api/v2/admin/orders')
  assert.equal(response.status, 503)
  assert.equal(response.body.error.code, 'ORDER_QUERY_UNAVAILABLE')
  assert.ok(!JSON.stringify(response.body).includes('PRIVATE'))
})

const { adminOrderService, createAlgoliaOrderSearch } = await import('../dist/services/adminOrderService.js')

/** Índice orders simulado: registra cada búsqueda y devuelve coincidencias con estados indexados. */
function fakeIndex(hitsFor) {
  const calls = []
  return { calls, search: async (q, filters, page, pageSize) => { calls.push({ q, filters, page, pageSize }); return hitsFor(q, filters, page, pageSize) } }
}

test('búsqueda en Algolia: IDs del índice, estado actual del store, índice desactualizado y Orders faltantes', async t => {
  const get = await http(t)
  const index = fakeIndex(() => ({ total: 3, hits: [
    // El índice todavía tiene la Order como pendiente; el store ya la tiene confirmada.
    { id: seeded.b2bAlajuela.id, orderStatus: 'PENDING', paymentStatus: 'PENDING' },
    { id: 'deleted-from-store', orderStatus: 'PENDING', paymentStatus: 'PENDING' },
    { id: seeded.b2bHeredia.id, orderStatus: 'PENDING', paymentStatus: 'PENDING' },
  ] }))
  t.mock.method(adminOrderService.search, 'search', index.search)
  const { status, body } = await get('/api/v2/admin/orders?q=Distribuidora&customerRole=B2B&branchId=heredia&pageSize=3')
  assert.equal(status, 200)
  assert.deepEqual(index.calls, [{ q: 'Distribuidora', filters: { customerRole: 'B2B', branchId: 'heredia' }, page: 1, pageSize: 3 }])
  assert.deepEqual(body.orders.map(order => [order.id, order.orderStatus, order.indexOutdated ?? false]),
    [[seeded.b2bAlajuela.id, 'CONFIRMED', true], [seeded.b2bHeredia.id, 'PENDING', false]])
  assert.deepEqual([body.source, body.total, body.missingFromStore, body.hasMore, body.pendingIndexOrders], ['algolia', 3, 1, false, null])
  assert.deepEqual(body.orders[0].company, { id: 'qa-company', name: 'Distribuidora QA' })
})

test('búsqueda: combinaciones no soportadas, índice no disponible y fallo temporal sin detalles internos', async t => {
  const get = await http(t)
  for (const query of ['q=CN&orderNumber=CN-1', 'q=CN&orderId=x', 'q=CN&sort=oldest']) {
    const response = await get('/api/v2/admin/orders?' + query)
    assert.deepEqual([response.status, response.body.error.code], [400, 'INVALID_ORDER_FILTER'], query)
  }
  // Sin variables del índice orders: la búsqueda informa que no está disponible.
  const unconfigured = createAlgoliaOrderSearch(() => { throw new Error('No debe crear el cliente') }, () => 'orders', () => false)
  await assert.rejects(unconfigured.search('CN', {}, 1, 20), { status: 503, code: 'ORDER_SEARCH_UNAVAILABLE' })
  const failing = createAlgoliaOrderSearch(() => ({ searchSingleIndex: async () => { throw Object.assign(new Error('PRIVATE key host'), { status: 500 }) } }), () => 'orders', () => true)
  await assert.rejects(failing.search('CN', {}, 1, 20), error => error.code === 'ORDER_SEARCH_UNAVAILABLE' && !error.message.includes('PRIVATE'))
  t.mock.method(adminOrderService.search, 'search', failing.search)
  const response = await get('/api/v2/admin/orders?q=CN')
  assert.deepEqual([response.status, response.body.error.code], [503, 'ORDER_SEARCH_UNAVAILABLE'])
  assert.ok(!JSON.stringify(response.body).includes('PRIVATE'))
  // El listado general sigue disponible desde la persistencia durante el fallo del índice.
  assert.equal((await get('/api/v2/admin/orders')).body.total, 5)
})

test('adaptador Algolia: índice orders, filtros validados, paginación base cero y solo lectura', async () => {
  const calls = []
  const search = createAlgoliaOrderSearch(() => ({ searchSingleIndex: async request => { calls.push(request); return { hits: [{ objectID: 'o1', orderStatus: 'PENDING', paymentStatus: 'PENDING' }], nbHits: 41 } } }),
    () => 'orders-test', () => true)
  assert.deepEqual(await search.search('CN-2026', { userId: 'qa-b2b', orderStatus: 'PENDING' }, 3, 20),
    { hits: [{ id: 'o1', orderStatus: 'PENDING', paymentStatus: 'PENDING' }], total: 41 })
  assert.deepEqual(calls, [{ indexName: 'orders-test', searchParams: { query: 'CN-2026', page: 2, hitsPerPage: 20,
    filters: 'userId:"qa-b2b" AND orderStatus:"PENDING"', attributesToRetrieve: ['orderStatus', 'paymentStatus'], attributesToHighlight: [] } }])
})
