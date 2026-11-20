/** CN-66: consulta administrativa global de Orders con app, RBAC y store reales (In-Memory), sin Algolia ni PostgreSQL. */
import test, { after, mock } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { basename, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { orderFixture } from './helpers/commerceFixtures.mjs'

// Se establece antes de cualquier import de App/configuración. Nunca depende del entorno del desarrollador.
const isolatedDotenv = fileURLToPath(new URL('./.env.cn66-unit-missing', import.meta.url))
assert.equal(fs.existsSync(isolatedDotenv), false, 'La ruta dotenv de CN-66 debe permanecer vacía.')
Object.assign(process.env, {
  DOTENV_CONFIG_PATH: isolatedDotenv, DOTENV_CONFIG_QUIET: 'true', DOTENV_CONFIG_DEBUG: 'false',
  DOTENV_CONFIG_OVERRIDE: 'false', DOTENV_CONFIG_ENCODING: 'utf8', DOTENV_KEY: '', DOTENV_CONFIG_DOTENV_KEY: '',
  COMMERCE_STORE_MODE: 'memory', ORDER_CREATION_MODE: 'v1-compatible',
  DATABASE_URL: '', DATABASE_TEST_URL: '', DATABASE_RUNTIME_TEST_URL: '', RUN_DATABASE_INTEGRATION_TESTS: '0',
  ALGOLIA_APP_ID: 'CN66_FAKE_APP', ALGOLIA_API_KEY: 'cn66-fake-key',
  ALGOLIA_INDEX_NAME: 'cn66_products', ALGOLIA_USERS_INDEX_NAME: 'cn66_users',
  ALGOLIA_ORDERS_INDEX_NAME: '', ALGOLIA_ORDERS_API_KEY: '', ALGOLIA_ORDERS_SETTINGS_API_KEY: '',
  ALGOLIA_ORDERS_RECONCILE_ON_START: 'false', ALGOLIA_SEED_API_KEY: '',
  CLIENT_ORIGIN: 'http://localhost:5173', PORT: '3001',
})

// Observa dotenv sin abrir rutas privadas y bloquea las dependencias externas dentro de este worker de test.
const audit = { dotenvReads: 0, unexpectedDotenvReads: 0, postgresAttempts: 0, algoliaAttempts: 0 }
const readFileSync = fs.readFileSync
mock.method(fs, 'readFileSync', function (file, ...options) {
  const path = file instanceof URL ? fileURLToPath(file) : typeof file === 'string' ? resolve(file) : undefined
  if (path && (basename(path) === '.env' || basename(path).startsWith('.env.'))) {
    if (path !== isolatedDotenv) {
      audit.unexpectedDotenvReads++
      throw new Error('CN66_UNEXPECTED_DOTENV_READ')
    }
    audit.dotenvReads++
  }
  return readFileSync.call(this, file, ...options)
})
after(() => {
  try {
    assert.equal(audit.unexpectedDotenvReads, 0, 'No se permiten lecturas dotenv ajenas al test.')
    assert.equal(audit.postgresAttempts, 0, 'No se permiten conexiones ni queries PostgreSQL.')
    assert.equal(audit.algoliaAttempts, 0, 'Algolia debe permanecer mockeado.')
  } finally { mock.restoreAll() }
})
const { Pool } = await import('pg')
for (const method of ['connect', 'query']) mock.method(Pool.prototype, method, () => {
  audit.postgresAttempts++
  throw new Error('CN66_POSTGRES_BLOCKED')
})

const { default: app } = await import('../dist/app.js')
const { serverConfig } = await import('../dist/config/env.js')
const { userService } = await import('../dist/services/userService.js')
const { commerceStores } = await import('../dist/stores/commerceStores.js')
const { paymentService } = await import('../dist/services/paymentService.js')
const { AdminOrderService, adminOrderService, createAlgoliaOrderSearch } = await import('../dist/services/adminOrderService.js')
const { InMemoryOrderStore } = await import('../dist/stores/orderStore.js')
const { InMemoryPaymentStore } = await import('../dist/stores/paymentStore.js')
const { parseAdminOrderQuery } = await import('../dist/domain/adminOrderQuery.js')
const { getAlgoliaClient } = await import('../dist/config/algolia.js')
const catalog = getAlgoliaClient()
for (const method of ['searchSingleIndex', 'getObject', 'getObjects', 'saveObjects', 'partialUpdateObject', 'deleteObject']) {
  mock.method(catalog, method, () => {
    audit.algoliaAttempts++
    throw new Error('CN66_ALGOLIA_BLOCKED')
  })
}

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

// Fail-closed antes del primer fixture: una composición incompatible nunca alcanza createOrReplay.
assert.equal(serverConfig.commerceStoreMode, 'memory', 'CN-66 requiere composición In-Memory.')
assert.ok(commerceStores.orders instanceof InMemoryOrderStore, 'El seed solo admite InMemoryOrderStore.')
assert.ok(commerceStores.payments instanceof InMemoryPaymentStore, 'Payments también debe ser In-Memory.')
assert.ok(audit.dotenvReads > 0, 'La configuración debe cargar dotenv únicamente después del aislamiento.')
assert.equal(audit.unexpectedDotenvReads, 0)
assert.equal(audit.postgresAttempts, 0)
const seeded = await seed(commerceStores.orders)

test('aislamiento CN-66: configuración ficticia, dotenv controlado y Stores In-Memory sin conexiones externas', () => {
  assert.equal(process.env.DOTENV_CONFIG_PATH, isolatedDotenv)
  assert.equal(process.env.DATABASE_URL, '')
  assert.equal(process.env.DATABASE_TEST_URL, '')
  assert.equal(process.env.DATABASE_RUNTIME_TEST_URL, '')
  assert.equal(serverConfig.commerceStoreMode, 'memory')
  assert.equal(serverConfig.ordersIndexReconcileOnStart, false)
  assert.ok(commerceStores.orders instanceof InMemoryOrderStore)
  assert.ok(commerceStores.payments instanceof InMemoryPaymentStore)
  assert.equal(audit.unexpectedDotenvReads, 0)
  assert.equal(audit.postgresAttempts, 0)
  assert.equal(audit.algoliaAttempts, 0)
})

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
  assert.deepEqual([body.page, body.pageSize, body.total, body.hasMore, body.source, body.pendingIndexOrders], [1, 20, 5, false, 'memory', null])
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
    [[seeded.b2bHeredia.id, 'PENDING', false]])
  assert.deepEqual([body.source, body.total, body.missingFromStore, body.hasMore, body.pendingIndexOrders], ['algolia', 3, 1, false, null])
  assert.deepEqual(body.orders[0].company, { id: 'qa-company', name: 'Distribuidora QA' })
})

const searchCandidates = [seeded.b2bAlajuela, seeded.b2bHeredia, seeded.b2cSanJose, seeded.otherCartago, seeded.legacy]
const pendingCandidates = [seeded.b2bHeredia, seeded.b2cSanJose, seeded.otherCartago, seeded.legacy]
for (const [label, filters, expected] of [
  ['PENDING excluye la Order ya CONFIRMED', { orderStatus: 'PENDING' }, pendingCandidates],
  ['CONFIRMED conserva el estado actual aunque Payment siga PENDING en el índice', { orderStatus: 'CONFIRMED' }, [seeded.b2bAlajuela]],
  ['Payment PENDING excluye el APPROVED autoritativo', { paymentStatus: 'PENDING' }, pendingCandidates],
  ['Payment APPROVED conserva la Order aunque el índice todavía indique Order PENDING', { paymentStatus: 'APPROVED' }, [seeded.b2bAlajuela]],
  ['Payment DECLINED excluye estados incompatibles', { paymentStatus: 'DECLINED' }, []],
  ['Payment ERROR excluye estados incompatibles', { paymentStatus: 'ERROR' }, []],
  ['Heredia excluye la sucursal Alajuela', { branchId: 'heredia' }, [seeded.b2bHeredia]],
  ['usuario usa el propietario persistido, también en V1 sin commercial', { userId: 'qa-b2c' }, [seeded.b2cSanJose, seeded.legacy]],
  ['rol B2C excluye compradores B2B', { customerRole: 'B2C' }, [seeded.b2cSanJose, seeded.otherCartago, seeded.legacy]],
  ['rol B2B excluye compradores B2C', { customerRole: 'B2B' }, [seeded.b2bAlajuela, seeded.b2bHeredia]],
  ['todos los filtros deben cumplirse conjuntamente', { userId: 'qa-b2b', customerRole: 'B2B', branchId: 'alajuela', orderStatus: 'CONFIRMED', paymentStatus: 'APPROVED' }, [seeded.b2bAlajuela]],
  ['filtros incompatibles no devuelven coincidencias', { userId: 'qa-b2c', customerRole: 'B2B' }, []],
]) {
  test('búsqueda con filtros autoritativos: ' + label, { timeout: 10000 }, async t => {
    const get = await http(t)
    // Algolia considera que todos estos candidatos cumplen los filtros, pero sus atributos pueden estar obsoletos.
    const index = fakeIndex(() => ({ total: searchCandidates.length, hits: searchCandidates.map(order => ({
      id: order.id, orderStatus: 'PENDING', paymentStatus: 'PENDING', ...filters,
    })) }))
    t.mock.method(adminOrderService.search, 'search', index.search)
    const query = new URLSearchParams({ q: 'CN-2026', pageSize: '5', ...filters })
    const { status, body } = await get('/api/v2/admin/orders?' + query)
    assert.equal(status, 200)
    assert.deepEqual(body.orders.map(order => order.id), expected.map(order => order.id))
    for (const row of body.orders) {
      const original = expected.find(order => order.id === row.id)
      assert.deepEqual([row.orderStatus, row.paymentStatus, row.total], [original.orderStatus, original.paymentStatus, original.totals.total])
    }
    assert.deepEqual(index.calls, [{ q: 'CN-2026', filters, page: 1, pageSize: 5 }])
    // El total sigue describiendo candidatos Algolia; no es el número de Orders válidas de esta página.
    assert.deepEqual([body.total, body.hasMore, body.missingFromStore], [5, false, 0])
  })
}

test('búsqueda textual: conserva snapshots y ranking de candidatos sin escanear ni escribir Orders', { timeout: 10000 }, async t => {
  const get = await http(t)
  const store = commerceStores.orders
  const before = await store.findEntriesByIds(searchCandidates.map(order => order.id))
  const index = fakeIndex(() => ({ total: 1, hits: [{ id: seeded.b2bAlajuela.id, orderStatus: 'PENDING', paymentStatus: 'PENDING' }] }))
  t.mock.method(adminOrderService.search, 'search', index.search)
  const scan = t.mock.method(store, 'listAll', () => assert.fail('La búsqueda no recorre todas las Orders.'))
  const writes = ['create', 'createOrReplay', 'update'].map(method => t.mock.method(store, method, () => assert.fail('La consulta no escribe Orders.')))
  const payment = t.mock.method(paymentService.sandbox, 'process', () => assert.fail('La consulta no procesa Payments.'))
  for (const q of ['Distribuidora QA', seeded.b2bAlajuela.orderNumber.toLowerCase().slice(0, 20)]) {
    const { status, body } = await get('/api/v2/admin/orders?' + new URLSearchParams({ q }))
    assert.equal(status, 200)
    assert.deepEqual(body.orders.map(row => row.id), [seeded.b2bAlajuela.id], 'No inventa coincidencias fuera de Algolia.')
    assert.deepEqual(body.orders[0], { id: seeded.b2bAlajuela.id, orderNumber: seeded.b2bAlajuela.orderNumber,
      createdAt: seeded.b2bAlajuela.createdAt, contractVersion: 2, userId: 'qa-b2b', displayName: 'Compras QA', customerRole: 'B2B',
      company: { id: 'qa-company', name: 'Distribuidora QA' }, branchId: 'alajuela', total: seeded.b2bAlajuela.totals.total,
      currency: 'CRC', orderStatus: 'CONFIRMED', paymentStatus: 'APPROVED', indexOutdated: true })
  }
  assert.deepEqual(index.calls.map(call => call.q), ['Distribuidora QA', seeded.b2bAlajuela.orderNumber.toLowerCase().slice(0, 20)])
  assert.deepEqual(await store.findEntriesByIds(searchCandidates.map(order => order.id)), before, 'Buyer, Company, Branch, importes y Terms no cambian.')
  assert.deepEqual(await store.findByIdempotencyKey('b2b-al', 'qa-b2b'), seeded.b2bAlajuela)
  assert.equal(scan.mock.callCount(), 0)
  for (const write of writes) assert.equal(write.mock.callCount(), 0)
  assert.equal(payment.mock.callCount(), 0)
})

test('búsqueda paginada: excluye candidatos obsoletos sin rellenar páginas ni confundirlos con IDs inexistentes', { timeout: 10000 }, async t => {
  const get = await http(t)
  const candidatesByPage = [
    [seeded.b2bAlajuela.id, 'missing-first', seeded.b2bHeredia.id],
    [seeded.b2bAlajuela.id, seeded.b2cSanJose.id, seeded.otherCartago.id],
    ['missing-last'],
  ]
  const index = fakeIndex((_q, _filters, page) => ({ total: 7, hits: candidatesByPage[page - 1].map(id => ({ id })) }))
  t.mock.method(adminOrderService.search, 'search', index.search)
  const reads = t.mock.method(commerceStores.orders, 'findEntriesByIds')
  t.mock.method(commerceStores.orders, 'listAll', () => assert.fail('No debe recalcular un total global.'))
  for (const [page, expectedIds, missing, hasMore] of [
    [1, [seeded.b2bHeredia.id], 1, true],
    [2, [], 0, true],
    [3, [], 1, false],
  ]) {
    const { status, body } = await get(`/api/v2/admin/orders?q=CN&branchId=heredia&pageSize=3&page=${page}`)
    assert.equal(status, 200)
    assert.deepEqual(body.orders.map(row => row.id), expectedIds)
    assert.deepEqual([body.page, body.pageSize, body.total, body.hasMore, body.missingFromStore], [page, 3, 7, hasMore, missing])
  }
  assert.deepEqual(index.calls, [1, 2, 3].map(page => ({ q: 'CN', filters: { branchId: 'heredia' }, page, pageSize: 3 })))
  assert.deepEqual(reads.mock.calls.map(call => call.arguments), candidatesByPage.map(ids => [ids]))
})

test('búsqueda sin coincidencias conserva una página vacía sin inventar Orders', { timeout: 10000 }, async t => {
  const get = await http(t)
  const index = fakeIndex(() => ({ total: 0, hits: [] }))
  t.mock.method(adminOrderService.search, 'search', index.search)
  const { status, body } = await get('/api/v2/admin/orders?q=no-match&pageSize=3')
  assert.equal(status, 200)
  assert.deepEqual(body.orders, [])
  assert.deepEqual([body.page, body.pageSize, body.total, body.hasMore, body.missingFromStore], [1, 3, 0, false, 0])
  assert.equal(index.calls.length, 1)
})

test('búsqueda: combinaciones no soportadas, índice no disponible y fallo temporal sin detalles internos', async t => {
  const get = await http(t)
  for (const query of ['q=CN&orderNumber=CN-1', 'q=CN&orderId=x', 'q=CN&sort=oldest']) {
    const response = await get('/api/v2/admin/orders?' + query)
    assert.deepEqual([response.status, response.body.error.code], [400, 'INVALID_ORDER_FILTER'], query)
    if (query === 'q=CN&sort=oldest') {
      assert.equal(response.body.error.message,
        'El orden ascendente por fecha no está disponible durante la búsqueda. Los resultados utilizan el orden del índice.')
      assert.doesNotMatch(response.body.error.message, /de la más reciente a la más antigua|orden cronológico/i)
    }
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
  const search = createAlgoliaOrderSearch(() => ({ searchSingleIndex: async request => { calls.push(request); return { hits: [{ objectID: 'o1', orderStatus: 'PENDING', paymentStatus: 'PENDING' }], nbHits: 41, exhaustive: { nbHits: true } } } }),
    () => 'orders-test', () => true)
  assert.deepEqual(await search.search('CN-2026', { userId: 'qa-b2b', orderStatus: 'PENDING' }, 3, 20),
    { hits: [{ id: 'o1', orderStatus: 'PENDING', paymentStatus: 'PENDING' }], total: 41 })
  assert.deepEqual(calls, [{ indexName: 'orders-test', searchParams: { query: 'CN-2026', page: 2, hitsPerPage: 20,
    filters: 'userId:"qa-b2b" AND orderStatus:"PENDING"', attributesToRetrieve: ['orderStatus', 'paymentStatus'], attributesToHighlight: [] } }])
})

/** Respuesta del SDK controlada; nunca utiliza un cliente ni una configuración remotos. */
const sdkSearch = response => createAlgoliaOrderSearch(() => ({ searchSingleIndex: async () => response }), () => 'orders-test', () => true)

for (const [label, metadata] of [
  ['indicador actual true', { exhaustive: { nbHits: true } }],
  ['indicador legacy true', { exhaustiveNbHits: true }],
  ['ambos indicadores true', { exhaustive: { nbHits: true }, exhaustiveNbHits: true }],
  ['legacy true y objeto actual sin nbHits', { exhaustive: { facetsCount: true }, exhaustiveNbHits: true }],
]) {
  test('conteo de candidatos exhaustivo: ' + label, async () => {
    const search = sdkSearch({ hits: [{ objectID: 'o1' }], nbHits: 12, ...metadata })
    assert.deepEqual(await search.search('CN', {}, 1, 20), { hits: [{ id: 'o1', orderStatus: undefined, paymentStatus: undefined }], total: 12 })
  })
}

for (const [label, metadata] of [
  ['actual false con nbHits entero', { exhaustive: { nbHits: false } }],
  ['legacy false', { exhaustiveNbHits: false }],
  ['ambos false', { exhaustive: { nbHits: false }, exhaustiveNbHits: false }],
  ['actual true y legacy false', { exhaustive: { nbHits: true }, exhaustiveNbHits: false }],
  ['actual false y legacy true', { exhaustive: { nbHits: false }, exhaustiveNbHits: true }],
  ['ambos ausentes', {}],
  ['objeto actual sin nbHits ni legacy', { exhaustive: { facetsCount: true } }],
  ['actual string', { exhaustive: { nbHits: 'true' } }],
  ['actual número', { exhaustive: { nbHits: 1 } }],
  ['actual null', { exhaustive: { nbHits: null } }],
  ['actual objeto', { exhaustive: { nbHits: {} } }],
  ['legacy string', { exhaustiveNbHits: 'true' }],
  ['legacy número', { exhaustiveNbHits: 1 }],
  ['legacy null', { exhaustiveNbHits: null }],
  ['legacy array', { exhaustiveNbHits: [true] }],
  ['objeto actual null incluso con legacy true', { exhaustive: null, exhaustiveNbHits: true }],
  ['objeto actual array incluso con legacy true', { exhaustive: [], exhaustiveNbHits: true }],
  ['objeto actual string incluso con legacy true', { exhaustive: 'true', exhaustiveNbHits: true }],
  ['actual mal formado con legacy true', { exhaustive: { nbHits: 'true' }, exhaustiveNbHits: true }],
  ['actual true con legacy mal formado', { exhaustive: { nbHits: true }, exhaustiveNbHits: 'true' }],
]) {
  test('conteo no verificable se rechaza: ' + label, async () => {
    const search = sdkSearch({ hits: [], nbHits: 12, ...metadata, debug: 'PRIVATE SDK payload' })
    await assert.rejects(search.search('CN', {}, 1, 20), error => error.status === 503
      && error.code === 'ORDER_SEARCH_UNAVAILABLE' && !error.message.includes('PRIVATE'))
  })
}

for (const [label, nbHits] of [
  ['negativo', -1], ['decimal', 1.5], ['NaN', NaN], ['infinito', Infinity], ['entero inseguro', Number.MAX_SAFE_INTEGER + 1],
  ['string', '12'], ['null', null], ['ausente', undefined],
]) {
  test('nbHits inválido se rechaza aunque exhaustive sea true: ' + label, async () => {
    await assert.rejects(sdkSearch({ hits: [], nbHits, exhaustive: { nbHits: true } }).search('CN', {}, 1, 20),
      { status: 503, code: 'ORDER_SEARCH_UNAVAILABLE' })
  })
}

test('conteo aproximado devuelve HTTP 503 sin hidratar, escribir ni realizar fallback; listado general disponible', { timeout: 10000 }, async t => {
  const get = await http(t)
  const store = commerceStores.orders
  t.mock.method(adminOrderService.search, 'search', sdkSearch({ hits: [{ objectID: seeded.b2bAlajuela.id }], nbHits: 12,
    exhaustive: { nbHits: false }, debug: 'PRIVATE SDK payload' }).search)
  const hydrate = t.mock.method(store, 'findEntriesByIds')
  const list = t.mock.method(store, 'listAll')
  const writes = ['create', 'createOrReplay', 'update'].map(method => t.mock.method(store, method, () => assert.fail('Search no escribe.')))
  const { status, body } = await get('/api/v2/admin/orders?q=CN')
  assert.deepEqual([status, body.error.code], [503, 'ORDER_SEARCH_UNAVAILABLE'])
  assert.ok(!JSON.stringify(body).includes('PRIVATE'))
  for (const field of ['orders', 'total', 'hasMore']) assert.equal(field in body, false)
  assert.equal(hydrate.mock.callCount(), 0)
  assert.equal(list.mock.callCount(), 0, 'No sustituye silenciosamente Search por listado general.')
  assert.equal((await get('/api/v2/admin/orders')).body.total, 5)
  for (const write of writes) assert.equal(write.mock.callCount(), 0)
})

test('conteo exhaustivo del índice no cuenta como Orders válidas las descartadas por F2-01 o inexistentes', { timeout: 10000 }, async t => {
  const get = await http(t)
  t.mock.method(adminOrderService.search, 'search', sdkSearch({ nbHits: 8, exhaustiveNbHits: true, hits: [
    { objectID: seeded.b2bAlajuela.id, orderStatus: 'PENDING', paymentStatus: 'PENDING' },
    { objectID: 'missing', orderStatus: 'PENDING', paymentStatus: 'PENDING' },
    { objectID: seeded.b2bHeredia.id, orderStatus: 'PENDING', paymentStatus: 'PENDING' },
  ] }).search)
  const { status, body } = await get('/api/v2/admin/orders?q=CN&orderStatus=PENDING&pageSize=3')
  assert.equal(status, 200)
  assert.deepEqual(body.orders.map(row => [row.id, row.orderStatus]), [[seeded.b2bHeredia.id, 'PENDING']])
  assert.deepEqual([body.page, body.pageSize, body.total, body.hasMore, body.missingFromStore], [1, 3, 8, true, 1])
})

test('Search exhaustivo conserva páginas de candidatos, última página y página fuera de rango sin rellenarlas', { timeout: 10000 }, async t => {
  const get = await http(t)
  const ids = [[seeded.b2bAlajuela.id, 'missing'], [seeded.b2bHeredia.id, seeded.b2cSanJose.id], [seeded.otherCartago.id], []]
  const calls = []
  const search = createAlgoliaOrderSearch(() => ({ searchSingleIndex: async request => {
    calls.push(request.searchParams)
    return { hits: ids[request.searchParams.page].map(objectID => ({ objectID })), nbHits: 5, exhaustive: { nbHits: true } }
  } }), () => 'orders-test', () => true)
  t.mock.method(adminOrderService.search, 'search', search.search)
  for (const [page, expected, hasMore] of [
    [1, [seeded.b2bAlajuela.id], true], [2, [seeded.b2bHeredia.id, seeded.b2cSanJose.id], true],
    [3, [seeded.otherCartago.id], false], [4, [], false],
  ]) {
    const { status, body } = await get(`/api/v2/admin/orders?q=CN&pageSize=2&page=${page}`)
    assert.equal(status, 200)
    assert.deepEqual(body.orders.map(row => row.id), expected)
    assert.deepEqual([body.page, body.pageSize, body.total, body.hasMore], [page, 2, 5, hasMore])
  }
  assert.deepEqual(calls.map(({ page, hitsPerPage }) => [page, hitsPerPage]), [[0, 2], [1, 2], [2, 2], [3, 2]])
})

test('Search legítimamente vacío requiere exhaustividad y conserva total cero', { timeout: 10000 }, async t => {
  const get = await http(t)
  t.mock.method(adminOrderService.search, 'search', sdkSearch({ hits: [], nbHits: 0, exhaustive: { nbHits: true } }).search)
  const { status, body } = await get('/api/v2/admin/orders?q=no-match')
  assert.equal(status, 200)
  assert.deepEqual([body.orders, body.total, body.hasMore], [[], 0, false])
})

for (const kind of ['memory', 'postgresql']) {
  test('origen del Repository efectivo en listado y Search: ' + kind, async t => {
    const backing = new InMemoryOrderStore()
    const fixtures = await seed(backing)
    const ids = Object.values(fixtures).map(order => order.id)
    const before = await backing.findEntriesByIds(ids)
    let store = backing
    if (kind === 'postgresql') {
      // Repository real con lecturas sustituidas; importar y construir no debe abrir ninguna conexión.
      const { PostgreSQLOrderStore } = await import('../dist/stores/postgreSQLOrderStore.js')
      store = new PostgreSQLOrderStore({
        connect: async () => assert.fail('No se permite conectar PostgreSQL.'),
        transaction: async () => assert.fail('No se permiten transacciones PostgreSQL.'),
      })
      t.mock.method(store, 'listAll', (...args) => backing.listAll(...args))
      t.mock.method(store, 'findEntriesByIds', requested => backing.findEntriesByIds(requested))
      t.mock.method(store, 'countPendingIndex', async () => 2)
    }
    const writes = ['createOrReplay', 'update'].map(method => t.mock.method(store, method, () => assert.fail('La consulta no escribe.')))
    const sandbox = t.mock.method(paymentService.sandbox, 'process', () => assert.fail('La consulta no procesa Payment.'))
    const search = sdkSearch({ nbHits: 2, exhaustive: { nbHits: true }, hits: [
      { objectID: fixtures.b2bAlajuela.id, orderStatus: 'PENDING', paymentStatus: 'PENDING' },
      { objectID: fixtures.b2bHeredia.id, orderStatus: 'PENDING', paymentStatus: 'PENDING' },
    ] })
    const service = new AdminOrderService(store, search)
    const general = await service.list({})
    assert.deepEqual([general.source, general.page, general.pageSize, general.total, general.hasMore, general.pendingIndexOrders],
      [kind, 1, 20, 5, false, kind === 'memory' ? null : 2])
    const row = general.orders.find(order => order.id === fixtures.b2bAlajuela.id)
    assert.deepEqual([row.customerRole, row.branchId, row.orderStatus, row.paymentStatus, row.total],
      ['B2B', 'alajuela', 'CONFIRMED', 'APPROVED', fixtures.b2bAlajuela.totals.total])
    assert.deepEqual(row.company, { id: 'qa-company', name: 'Distribuidora QA' })
    const indexed = await service.list({ q: 'CN', orderStatus: 'PENDING' })
    assert.equal(indexed.source, 'algolia', 'Identifica el proveedor de candidatos, no atribuye la hidratación a Algolia ni PostgreSQL.')
    assert.deepEqual(indexed.orders.map(order => [order.id, order.orderStatus, order.paymentStatus]), [[fixtures.b2bHeredia.id, 'PENDING', 'PENDING']])
    assert.deepEqual([indexed.page, indexed.pageSize, indexed.total, indexed.hasMore, indexed.missingFromStore], [1, 20, 2, false, 0])
    assert.equal(indexed.pendingIndexOrders, kind === 'memory' ? null : 2)
    assert.deepEqual(await backing.findEntriesByIds(ids), before, 'Los snapshots y estados originales permanecen intactos.')
    for (const write of writes) assert.equal(write.mock.callCount(), 0)
    assert.equal(sandbox.mock.callCount(), 0)
    assert.equal(serverConfig.commerceStoreMode, 'memory', 'La inyección de prueba no activa PostgreSQL comercialmente.')
  })
}

test('un Repository no identificado no se etiqueta como PostgreSQL ni Memory por suposición', async () => {
  const service = new AdminOrderService({ listAll: async () => ({ entries: [], total: 0 }), countPendingIndex: async () => null })
  await assert.rejects(service.list({}), { status: 503, code: 'ORDER_QUERY_UNAVAILABLE' })
})
