import './helpers/postgresIntegrationIsolation.mjs'
/**
 * CN-69 E2E de API con stack real: servicios HTTP del Client → Express → PostgreSQL aislado.
 * Algolia (catálogo y users) se sustituye por un catálogo QA en memoria; nunca se contactan servicios productivos.
 * Requiere el mismo opt-in y la misma base efímera que las demás suites de integración.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { QA_ALGOLIA_ENV, QA_PRODUCTS, QA_USERS, createFakeAlgoliaCatalog } from './helpers/fakeAlgoliaCatalog.mjs'
import { guardIntegrationDatabase, verifyIntegrationDatabases } from './helpers/postgresIntegrationHarness.mjs'

const enabled = process.env.RUN_DATABASE_INTEGRATION_TESTS === '1'
// Las variables ficticias de Algolia deben existir antes de cargar la configuración del Server.
Object.assign(process.env, QA_ALGOLIA_ENV)

const ts = createRequire(new URL('../../client/package.json', import.meta.url))('typescript')
const dataUrl = source => 'data:text/javascript;base64,' + Buffer.from(source).toString('base64')

/** Transpila un módulo real del Client y sus dependencias relativas, apuntando sus requests al Server de prueba. */
function clientModule(base) {
  const cache = new Map()
  const root = new URL('../../client/src/', import.meta.url)
  const compile = file => {
    if (cache.has(file)) return cache.get(file)
    const extension = existsSync(new URL(file + '.tsx', root)) ? '.tsx' : '.ts'
    const source = readFileSync(new URL(file + extension, root), 'utf8').replaceAll('import.meta.env.VITE_API_BASE_URL', JSON.stringify(base))
    const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ESNext } }).outputText
    const url = dataUrl(js.replace(/from ['"](\.[^'"]+)['"]/g, (_, dependency) =>
      'from ' + JSON.stringify(compile(path.posix.normalize(path.posix.join(path.posix.dirname(file), dependency))))))
    cache.set(file, url)
    return url
  }
  return file => import(compile(file))
}

test('CN-69 E2E Proyecto III: Client HTTP → Express → PostgreSQL con catálogo QA', {
  skip: enabled ? false : 'Requiere RUN_DATABASE_INTEGRATION_TESTS=1 y la base efímera cibernova_test.', timeout: 120000,
}, async t => {
  const [{ serverConfig }, { getAlgoliaClient }, { orderService }, { paymentService }, { userService },
    { Database }, { getDatabaseTestConfig }, { PostgreSQLOrderStore }, { PostgreSQLPaymentStore }] = await Promise.all([
    import('../dist/config/env.js'), import('../dist/config/algolia.js'), import('../dist/services/orderService.js'),
    import('../dist/services/paymentService.js'), import('../dist/services/userService.js'), import('../dist/db/pool.js'),
    import('../dist/config/database.js'), import('../dist/stores/postgreSQLOrderStore.js'), import('../dist/stores/postgreSQLPaymentStore.js')])
  serverConfig.clientOrigin = 'http://localhost:5173'
  const { default: app } = await import('../dist/app.js')

  // Base efímera de CI: el administrador solo verifica filas; la aplicación usa el rol runtime separado.
  const adminConfig = getDatabaseTestConfig()
  assert.equal(adminConfig.database, 'cibernova_test', 'Solo la base efímera cibernova_test.')
  const runtimeConfig = getDatabaseTestConfig({ ...process.env, DATABASE_TEST_URL: process.env.DATABASE_RUNTIME_TEST_URL })
  assert.equal(runtimeConfig.user, 'cibernova_app')
  const admin = guardIntegrationDatabase(new Database(() => ({ ...adminConfig, max: 2 })), 'admin')
  const pools = [admin]
  t.after(async () => { await Promise.all(pools.map(pool => pool.close())) })
  const previous = { orders: orderService.store, payments: paymentService.store, persistence: paymentService.persistence }
  t.after(() => { orderService.store = previous.orders; paymentService.store = previous.payments; paymentService.persistence = previous.persistence })
  /** Reconstruye el Pool y los Stores dentro del mismo proceso; verifica el recurso antes de utilizarlos. */
  const startPersistence = async () => {
    const db = guardIntegrationDatabase(new Database(() => ({ ...runtimeConfig, max: 4 })), 'runtime')
    pools.push(db)
    await verifyIntegrationDatabases(admin, db)
    const store = new PostgreSQLOrderStore(db)
    orderService.store = store
    paymentService.store = store
    paymentService.persistence = new PostgreSQLPaymentStore(store, db)
  }
  await startPersistence()

  // Algolia simulado sobre la instancia real que usan productService y UserService.
  const catalog = createFakeAlgoliaCatalog()
  const algolia = getAlgoliaClient()
  t.mock.method(algolia, 'searchSingleIndex', catalog.searchSingleIndex)
  t.mock.method(algolia, 'getObject', catalog.getObject)
  // Identidades únicas por ejecución: el historial no mezcla datos de corridas anteriores.
  const run = randomUUID().slice(0, 8)
  const records = QA_USERS.map(user => ({ ...user, objectID: user.objectID + '-' + run }))
  const id = name => 'qa-' + name + '-' + run
  t.mock.method(userService.directory, 'find', async userId => records.find(record => record.objectID === userId))
  t.mock.method(userService.directory, 'list', async () => records)
  const sandbox = t.mock.method(paymentService.sandbox, 'process', async request => ({ result: request.scenario }))

  const server = app.listen(0, '127.0.0.1')
  await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject) })
  t.after(() => new Promise(resolve => { server.close(() => resolve()); server.closeAllConnections() }))
  const base = 'http://127.0.0.1:' + server.address().port
  const load = clientModule(base)
  const [{ sessionApi }, productApi, { orderApi, OrderApiError, classifyOrderFailure }, { paymentApi, PaymentApiError },
    { orderHistoryApi, OrderHistoryApiError }, { calculateCartTotals }] = await Promise.all([
    load('services/sessionApi'), load('services/productApi'), load('services/orderApi'), load('services/paymentApi'),
    load('services/orderHistoryApi'), load('utils/cartCalculations')])
  const raw = (route, userId, body) => fetch(base + route, { method: body === undefined ? 'GET' : 'POST',
    headers: { ...(userId ? { 'X-CiberNova-User-Id': userId } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
  const signal = () => AbortSignal.timeout(5000)
  const price = (productId, role) => {
    const record = QA_PRODUCTS.find(product => product.objectID === productId)
    return role === 'B2B' ? record.b2b.wholesale_price : record.price
  }
  /** Solicitud de Checkout V2 tal como la arma CheckoutPage: referencias, sucursal y expectativas del Client. */
  const checkout = (lines, role, branchId = 'san_jose', key = randomUUID()) => ({
    buyer: { fullName: 'Persona QA', email: 'qa@example.com', phone: '88888888' },
    delivery: { province: 'San José', canton: 'Central', address: 'Dirección QA' },
    items: lines.map(([productId, quantity]) => ({ productId, quantity })), idempotencyKey: key, branchId,
    termsAcceptance: { accepted: true, version: '2026-10-lab4-v1' },
    financialExpectation: calculateCartTotals(lines.map(([productId, quantity]) => ({ price: price(productId, role), quantity }))),
  })
  const ordersOf = async owner => (await admin.query('SELECT id, owner_user_id, branch_id, pricing_type, order_status, payment_status, total, user_snapshot FROM commerce.orders WHERE owner_user_id = $1 ORDER BY created_at, id', [owner])).rows
  const attemptsOf = async orderId => Number((await admin.query('SELECT count(*) AS value FROM commerce.payment_attempts WHERE order_id = $1', [orderId])).rows[0].value)
  const created = {}

  await t.test('E2E-01 Simulated Login B2C resuelve identidad y rol desde el Server', async () => {
    const user = await sessionApi.resolveUser(id('b2c'), signal())
    assert.deepEqual([user.id, user.role, 'company' in user], [id('b2c'), 'B2C', false])
    const users = await sessionApi.listUsers(signal())
    assert.ok(users.some(entry => entry.id === id('b2c')))
    assert.equal(users.some(entry => entry.id === id('disabled')), false, 'Las cuentas deshabilitadas no se ofrecen')
  })

  await t.test('E2E-02 Simulated Login B2B incluye la empresa validada por el Server', async () => {
    const user = await sessionApi.resolveUser(id('b2b'), signal())
    assert.deepEqual([user.role, user.company.name], ['B2B', 'Distribuidora QA'])
  })

  await t.test('E2E-03 Simulated Login ADMIN resuelve el rol administrativo', async () => {
    assert.equal((await sessionApi.resolveUser(id('admin'), signal())).role, 'ADMIN')
    await assert.rejects(sessionApi.resolveUser(id('disabled'), signal()))
  })

  await t.test('E2E-05 Catálogo con precios Retail para anónimo y B2C', async () => {
    for (const userId of [undefined, id('b2c')]) {
      const page = await productApi.getCatalogPage(1, 20, undefined, '', userId)
      assert.equal(page.totalProducts, QA_PRODUCTS.length)
      for (const product of page.products) {
        assert.equal(product.pricing.type, 'RETAIL')
        assert.equal(product.price, QA_PRODUCTS.find(record => record.objectID === product.id).price)
      }
    }
  })

  await t.test('E2E-06 Catálogo con precios Wholesale para B2B y bloqueo de productos sin condición B2B', async () => {
    const page = await productApi.getCatalogPage(1, 20, undefined, '', id('b2b'))
    const ssd = page.products.find(product => product.id === 'qa-ssd-1tb')
    assert.deepEqual([ssd.pricing.type, ssd.price, ssd.pricing.minOrderQuantity], ['WHOLESALE', 39000, 3])
    const mouse = page.products.find(product => product.id === 'qa-mouse')
    assert.equal(mouse.pricing.eligible, false)
    assert.equal(mouse.canAddToCart, false)
  })

  await t.test('E2E-08 Selección de sucursal y consulta de inventario por sucursal', async () => {
    const branches = await productApi.getBranches()
    assert.deepEqual(branches.map(branch => branch.id).sort(), ['alajuela', 'cartago', 'heredia', 'san_jose'])
    const byBranch = async branchId => (await productApi.getProductsByIds(['qa-ssd-1tb'], id('b2c'), branchId))[0].inventory
    const alajuela = await byBranch('alajuela')
    assert.deepEqual([alajuela.branchId, alajuela.quantity], ['alajuela', 2])
    const cartago = await byBranch('cartago')
    assert.equal(cartago.quantity, 0)
    assert.notEqual(cartago.status, 'available')
  })

  await t.test('E2E-07 MOQ B2B: bajo el mínimo se rechaza sin crear Order; en el mínimo se acepta', async () => {
    const before = (await ordersOf(id('b2b'))).length
    await assert.rejects(orderApi.createOrder(checkout([['qa-ssd-1tb', 2]], 'B2B'), id('b2b')), error =>
      error instanceof OrderApiError && error.conclusive && error.code === 'INVALID_MOQ' && classifyOrderFailure(error).kind === 'BELOW_MINIMUM_QUANTITY')
    assert.equal((await ordersOf(id('b2b'))).length, before)
    const order = await orderApi.createOrder(checkout([['qa-ssd-1tb', 3]], 'B2B'), id('b2b'))
    assert.equal(order.items[0].minOrderQuantity, 3)
    created.moq = order
  })

  await t.test('E2E-09 Inventario insuficiente en la sucursal elegida se rechaza sin crear Order', async () => {
    const before = (await ordersOf(id('b2c'))).length
    await assert.rejects(orderApi.createOrder(checkout([['qa-ssd-1tb', 3]], 'B2C', 'alajuela'), id('b2c')), error =>
      error instanceof OrderApiError && error.conclusive && error.code === 'INSUFFICIENT_INVENTORY')
    await assert.rejects(orderApi.createOrder(checkout([['qa-router', 1]], 'B2C'), id('b2c')), error =>
      error.conclusive && ['INSUFFICIENT_INVENTORY', 'INVENTORY_UNAVAILABLE'].includes(error.code))
    assert.equal((await ordersOf(id('b2c'))).length, before)
  })

  await t.test('E2E-11 Compra B2C completa: Checkout V2 y Payment APPROVED con importes Retail', async () => {
    const order = await orderApi.createOrder(checkout([['qa-monitor-27', 1], ['qa-mouse', 2]], 'B2C'), id('b2c'))
    assert.deepEqual([order.commercial.customerRole, order.commercial.pricingType, order.commercial.branchId], ['B2C', 'RETAIL', 'san_jose'])
    assert.deepEqual(order.totals, calculateCartTotals([{ price: 165000, quantity: 1 }, { price: 12500, quantity: 2 }]))
    const result = await paymentApi.processPayment(order.id, { scenario: 'PAYMENT_APPROVED', idempotencyKey: randomUUID() }, id('b2c'))
    assert.deepEqual([result.order.orderStatus, result.order.paymentStatus], ['CONFIRMED', 'APPROVED'])
    created.b2c = result.order
  })

  await t.test('E2E-12 Compra B2B completa con Wholesale, MOQ y empresa histórica', async () => {
    const order = await orderApi.createOrder(checkout([['qa-ram-32', 4], ['qa-keyboard', 5]], 'B2B', 'alajuela'), id('b2b'))
    assert.deepEqual(order.items.map(item => item.unitPrice), [64000, 33000])
    assert.equal(order.commercial.company.name, 'Distribuidora QA')
    const result = await paymentApi.processPayment(order.id, { scenario: 'PAYMENT_APPROVED', idempotencyKey: randomUUID() }, id('b2b'))
    assert.equal(result.order.orderStatus, 'CONFIRMED')
    created.b2b = result.order
  })

  await t.test('E2E-13 Orders persistidas en PostgreSQL con propietario, sucursal y tipo de precio', async () => {
    const rows = await ordersOf(id('b2b'))
    const row = rows.find(entry => entry.id === created.b2b.id)
    assert.deepEqual([row.owner_user_id, row.branch_id, row.pricing_type, row.order_status, row.payment_status],
      [id('b2b'), 'alajuela', 'WHOLESALE', 'CONFIRMED', 'APPROVED'])
    assert.equal(Number(row.total), created.b2b.totals.total)
    assert.equal(row.user_snapshot.company.name, 'Distribuidora QA')
    assert.ok((await ordersOf(id('b2c'))).some(entry => entry.id === created.b2c.id))
  })

  await t.test('E2E-14 Payment Sandbox DECLINED, ERROR y Retry APPROVED con Attempts persistidos', async () => {
    const order = await orderApi.createOrder(checkout([['qa-headset', 1]], 'B2C', 'heredia'), id('b2c'))
    for (const scenario of ['PAYMENT_DECLINED', 'PAYMENT_ERROR']) {
      const result = await paymentApi.processPayment(order.id, { scenario, idempotencyKey: randomUUID() }, id('b2c'))
      assert.equal(result.order.orderStatus, 'PENDING')
    }
    const approved = await paymentApi.processPayment(order.id, { scenario: 'PAYMENT_APPROVED', idempotencyKey: randomUUID() }, id('b2c'))
    assert.equal(approved.order.paymentStatus, 'APPROVED')
    assert.equal(await attemptsOf(order.id), 3)
    await assert.rejects(paymentApi.processPayment(order.id, { scenario: 'PAYMENT_APPROVED', idempotencyKey: randomUUID() }, id('b2c')),
      error => error instanceof PaymentApiError && error.code === 'ORDER_ALREADY_CONFIRMED')
    created.retried = order
  })

  await t.test('E2E-15 Idempotency, Retry y Replay sin duplicar Orders ni pagos', async () => {
    const request = checkout([['qa-laptop-14', 1]], 'B2C')
    const first = await orderApi.createOrder(request, id('b2c'))
    assert.deepEqual(await orderApi.createOrder(request, id('b2c')), first, 'Replay devuelve la misma Order')
    assert.equal((await ordersOf(id('b2c'))).filter(row => row.id === first.id).length, 1)
    await assert.rejects(orderApi.createOrder({ ...request, buyer: { ...request.buyer, fullName: 'Otro' } }, id('b2c')), error =>
      error.conclusive && classifyOrderFailure(error).kind === 'IDEMPOTENCY_CONFLICT')
    const payment = { scenario: 'PAYMENT_DECLINED', idempotencyKey: randomUUID() }
    const calls = sandbox.mock.callCount()
    const declined = await paymentApi.processPayment(first.id, payment, id('b2c'))
    assert.deepEqual(await paymentApi.processPayment(first.id, payment, id('b2c')), declined, 'Replay del resultado histórico')
    assert.equal(sandbox.mock.callCount(), calls + 1)
    assert.equal(await attemptsOf(first.id), 1)
    created.replayed = first
    created.replayRequest = request
    created.declinedPayment = { request: payment, result: declined }
  })

  await t.test('E2E-18 Requests concurrentes con la misma key crean una sola Order y un solo Attempt', async () => {
    const request = checkout([['qa-keyboard', 1]], 'B2C', 'alajuela')
    const orders = await Promise.all(Array.from({ length: 6 }, () => orderApi.createOrder(request, id('b2c-2')).catch(error => error)))
    const succeeded = orders.filter(order => !(order instanceof Error))
    assert.ok(succeeded.length >= 1)
    assert.equal(new Set(succeeded.map(order => order.id)).size, 1)
    assert.equal((await ordersOf(id('b2c-2'))).length, 1)
    const orderId = succeeded[0].id
    const payment = { scenario: 'PAYMENT_APPROVED', idempotencyKey: randomUUID() }
    const results = await Promise.allSettled(Array.from({ length: 4 }, () => paymentApi.processPayment(orderId, payment, id('b2c-2'))))
    assert.ok(results.some(result => result.status === 'fulfilled'))
    assert.equal(await attemptsOf(orderId), 1)
  })

  await t.test('E2E-04 RBAC: ADMIN no compra ni paga, compradores no ven Orders ajenas e identidades inválidas se rechazan', async () => {
    const adminBuy = await raw('/api/v2/orders', id('admin'), checkout([['qa-ssd-1tb', 1]], 'B2C'))
    assert.deepEqual([adminBuy.status, (await adminBuy.json()).error.code], [403, 'FORBIDDEN'])
    await assert.rejects(paymentApi.processPayment(created.b2c.id, { scenario: 'PAYMENT_APPROVED', idempotencyKey: randomUUID() }, id('admin')),
      error => error.code === 'FORBIDDEN')
    await assert.rejects(orderHistoryApi.listMine(id('admin'), 1, 10), error => error instanceof OrderHistoryApiError && error.kind === 'forbidden')
    await assert.rejects(orderHistoryApi.getOrder(id('b2c'), created.b2b.id), error => error.kind === 'not-found')
    await assert.rejects(orderHistoryApi.getOrder(id('b2b'), created.b2c.id), error => error.kind === 'not-found')
    assert.equal((await raw('/api/v2/orders/mine', undefined)).status, 401)
    assert.equal((await raw('/api/v2/orders/mine', id('disabled'))).status, 403)
    assert.equal((await raw('/api/orders/' + created.b2c.id + '/payment', id('b2c-2'), { scenario: 'PAYMENT_APPROVED', idempotencyKey: 'x' })).status, 404)
    const adminRead = await raw('/api/v2/orders/' + created.b2b.id, id('admin'))
    assert.equal(adminRead.status, 200, 'ADMIN conserva la consulta individual global del CN-63')
  })

  await t.test('E2E-16 Order History: cada comprador ve solo sus Orders, recientes primero, con detalle autorizado', async () => {
    const mine = await orderHistoryApi.listMine(id('b2c'), 1, 10)
    const expected = [created.replayed, created.retried, created.b2c].map(order => order.id)
    assert.deepEqual(mine.orders.map(order => order.id).filter(orderId => expected.includes(orderId)), expected)
    assert.ok(mine.orders.every(order => order.branchId !== null && order.contractVersion === 2))
    assert.equal((await orderHistoryApi.listMine(id('b2b'), 1, 10)).orders.some(order => order.id === created.b2c.id), false)
    const detail = await orderHistoryApi.getOrder(id('b2b'), created.b2b.id)
    assert.deepEqual(detail.totals, created.b2b.totals)
    assert.equal(detail.commercial.company.name, 'Distribuidora QA')
    const paged = await orderHistoryApi.listMine(id('b2c'), 2, 1)
    assert.deepEqual([paged.page, paged.orders.length, paged.hasMore], [2, 1, true])
  })

  await t.test('E2E-17 Recuperación después de reiniciar: historial, detalle y Replay salen de PostgreSQL', async () => {
    await startPersistence()
    const calls = catalog.calls.length
    const mine = await orderHistoryApi.listMine(id('b2b'), 1, 10)
    assert.ok(mine.orders.some(order => order.id === created.b2b.id && order.orderStatus === 'CONFIRMED'))
    assert.deepEqual(await orderHistoryApi.getOrder(id('b2b'), created.b2b.id), created.b2b)
    // Replay del Payment Attempt persistido antes del reinicio: mismo resultado histórico, sin volver al Sandbox.
    const sandboxCalls = sandbox.mock.callCount()
    const { request, result } = created.declinedPayment
    assert.deepEqual(await paymentApi.processPayment(created.replayed.id, request, id('b2c')), result)
    assert.equal(sandbox.mock.callCount(), sandboxCalls)
    assert.equal(await attemptsOf(created.replayed.id), 1)
    // Replay de creación tras el reinicio: misma Order, sin consultar el catálogo ni crear otra fila.
    const replayed = await orderApi.createOrder(created.replayRequest, id('b2c'))
    assert.deepEqual([replayed.id, replayed.totals], [created.replayed.id, created.replayed.totals])
    assert.equal((await ordersOf(id('b2c'))).filter(row => row.id === replayed.id).length, 1)
    assert.equal(catalog.calls.length, calls, 'La recuperación no reconstruye precios desde el catálogo')
  })

  await t.test('E2E-19 Regresión de búsqueda, filtros, ordenamiento y paginación del catálogo', async () => {
    const suggestions = await productApi.searchProducts('ssd', id('b2c'))
    assert.equal(suggestions[0].id, 'qa-ssd-1tb')
    assert.match(suggestions[0].highlightedName, /<mark>SSD<\/mark>/)
    const filters = { categories: ['Periféricos'], brands: [], specifications: {}, minPrice: '', maxPrice: '', sort: 'price_asc' }
    const sorted = await productApi.getCatalogPage(1, 20, filters, '', id('b2c'))
    const prices = sorted.products.map(product => product.price)
    assert.deepEqual(prices, [...prices].sort((a, b) => a - b))
    assert.ok(sorted.products.every(product => ['qa-mouse', 'qa-keyboard', 'qa-headset'].includes(product.id)))
    const second = await productApi.getCatalogPage(2, 3, undefined, '', id('b2c'))
    assert.deepEqual([second.page, second.products.length, second.totalPages], [2, 3, 3])
  })
})
