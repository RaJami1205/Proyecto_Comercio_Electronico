/** CN-64 Order History por HTTP: ownership, paginación estable, DTO resumido y compatibilidad histórica. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { serverConfig } from '../dist/config/env.js'
import { orderService } from '../dist/services/orderService.js'
import { paymentService } from '../dist/services/paymentService.js'
import { InMemoryOrderStore } from '../dist/stores/orderStore.js'
import { InMemoryPaymentStore } from '../dist/stores/paymentStore.js'
import { parseOrderHistoryQuery, toOrderSummary, ORDER_HISTORY_MAX_PAGE_SIZE } from '../dist/domain/orderHistory.js'
import { orderFixture } from './helpers/commerceFixtures.mjs'
import { mockUserDirectory } from './helpers/identity.mjs'

serverConfig.clientOrigin = 'https://rajami1205.github.io'
const { default: app } = await import('../dist/app.js')

const records = [
  { objectID: 'buyer', displayName: 'Cliente', role: 'B2C', enabled: true },
  { objectID: 'other', displayName: 'Otro', role: 'B2C', enabled: true },
  { objectID: 'business', displayName: 'Compras', role: 'B2B', enabled: true, company: { id: 'co', name: 'Empresa ficticia' } },
  { objectID: 'empty', displayName: 'Sin compras', role: 'B2C', enabled: true },
  { objectID: 'admin', displayName: 'Administración', role: 'ADMIN', enabled: true },
  { objectID: 'off', displayName: 'Off', role: 'B2C', enabled: false },
]
const SUMMARY_KEYS = ['branchId', 'contractVersion', 'createdAt', 'currency', 'id', 'orderNumber', 'orderStatus', 'paymentStatus', 'total']
const orderInput = (key, quantity = 1) => ({ buyer: { fullName: 'Prueba', email: 'test@example.com', phone: '88888888' },
  delivery: { province: 'San José', canton: 'Central', address: 'Ficticia' }, items: [{ productId: 'p', quantity }],
  idempotencyKey: key, branchId: 'san_jose', termsAcceptance: { accepted: true, version: '2026-10-lab4-v1' } })

async function environment(t) {
  mockUserDirectory(t, records)
  const previous = { orders: orderService.store, payments: paymentService.store, persistence: paymentService.persistence }
  const store = new InMemoryOrderStore()
  orderService.store = store
  paymentService.store = store
  paymentService.persistence = new InMemoryPaymentStore(store)
  t.after(() => { orderService.store = previous.orders; paymentService.store = previous.payments; paymentService.persistence = previous.persistence })
  let price = 10000
  t.mock.method(orderService, 'lookup', async id => ({ objectID: id, title: 'Producto', price, in_stock: true, stock_quantity: 50,
    b2b: { available: true, wholesale_price: price * 0.8, min_order_quantity: 3 }, stock_by_branch: { san_jose: 50 } }))
  t.mock.method(paymentService.sandbox, 'process', async request => ({ result: request.scenario }))
  const server = app.listen(0, '127.0.0.1')
  await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject) })
  t.after(() => new Promise(resolve => { server.close(() => resolve()); server.closeAllConnections() }))
  const base = 'http://127.0.0.1:' + server.address().port
  const request = (path, id, body) => fetch(base + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { ...(id === null ? {} : { 'X-CiberNova-User-Id': id }), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(3000),
  })
  const create = async (id, key) => {
    const response = await request('/api/v2/orders', id, orderInput(key, id === 'business' ? 3 : 1))
    assert.equal(response.status, 201)
    return response.json()
  }
  return { store, request, create, setPrice: value => { price = value } }
}

const mine = async (h, id, query = '') => {
  const response = await h.request('/api/v2/orders/mine' + query, id)
  assert.equal(response.status, 200)
  return response.json()
}

async function expectError(response, status, code) {
  assert.equal(response.status, status)
  const body = await response.json()
  assert.equal(body.error.code, code)
  return body
}

test('parseOrderHistoryQuery sigue la convención del catálogo y limita el tamaño', () => {
  assert.deepEqual(parseOrderHistoryQuery({}), { page: 1, pageSize: 10, offset: 0 })
  assert.deepEqual(parseOrderHistoryQuery({ page: '3', pageSize: '5' }), { page: 3, pageSize: 5, offset: 10 })
  assert.equal(parseOrderHistoryQuery({ pageSize: '500' }).pageSize, ORDER_HISTORY_MAX_PAGE_SIZE)
  for (const invalid of ['0', '-1', '1.5', 'abc', '', '1e3', ['2'], 2]) {
    assert.equal(parseOrderHistoryQuery({ page: invalid }).page, 1, String(invalid))
    assert.equal(parseOrderHistoryQuery({ pageSize: invalid }).pageSize, 10, String(invalid))
  }
})

test('B2C lista solo sus Orders con DTO resumido, más reciente primero', { timeout: 10000 }, async t => {
  const h = await environment(t)
  const created = []
  for (const key of ['b1', 'b2', 'b3']) { created.push(await h.create('buyer', key)); await new Promise(resolve => setTimeout(resolve, 5)) }
  await h.create('other', 'o1')
  const page = await mine(h, 'buyer')
  assert.equal(page.total, 3)
  assert.equal(page.hasMore, false)
  assert.deepEqual(page.orders.map(order => order.id), created.map(order => order.id).reverse())
  for (const summary of page.orders) {
    assert.deepEqual(Object.keys(summary).sort(), SUMMARY_KEYS)
    assert.equal(summary.branchId, 'san_jose')
    assert.equal(summary.contractVersion, 2)
  }
  assert.deepEqual(page.orders[0], toOrderSummary(created[2]))
})

test('B2B lista sus Orders con totales Wholesale históricos aunque cambie el catálogo', { timeout: 10000 }, async t => {
  const h = await environment(t)
  const order = await h.create('business', 'biz')
  h.setPrice(99999)
  const page = await mine(h, 'business')
  assert.equal(page.total, 1)
  assert.equal(page.orders[0].total, order.totals.total)
  const detail = await (await h.request('/api/v2/orders/' + order.id, 'business')).json()
  assert.deepEqual(detail, order, 'El detalle conserva precios, empresa y sucursal históricos')
  assert.equal(detail.items[0].unitPrice, 8000)
  assert.equal(detail.commercial.company.name, 'Empresa ficticia')
  assert.deepEqual((await mine(h, 'buyer')).orders, [])
})

test('usuario sin Orders recibe una página vacía real', { timeout: 10000 }, async t => {
  const h = await environment(t)
  await h.create('buyer', 'someone-else')
  assert.deepEqual(await mine(h, 'empty'), { orders: [], page: 1, pageSize: 10, total: 0, hasMore: false })
})

test('ADMIN no usa My Orders y las identidades inválidas se rechazan antes de consultar', { timeout: 10000 }, async t => {
  const h = await environment(t)
  const list = t.mock.method(h.store, 'listByOwner')
  await expectError(await h.request('/api/v2/orders/mine', 'admin'), 403, 'FORBIDDEN')
  for (const [id, status, code] of [[null, 401, 'IDENTITY_REQUIRED'], ['missing', 404, 'USER_NOT_FOUND'], ['off', 403, 'USER_DISABLED']]) {
    await expectError(await h.request('/api/v2/orders/mine', id), status, code)
  }
  assert.equal(list.mock.callCount(), 0)
})

test('paginación estable con timestamps empatados, sin duplicados ni omisiones', { timeout: 10000 }, async t => {
  const h = await environment(t)
  const expected = []
  // Inserción en orden inverso: sin el desempate por id, un sort estable devolvería los empates al revés.
  for (let index = 22; index >= 0; index -= 1) {
    // Grupos de tres Orders con el mismo createdAt fuerzan el desempate por id.
    const createdAt = new Date(Date.UTC(2026, 10, 1 + Math.floor(index / 3))).toISOString()
    const order = { ...orderFixture('order-' + String(index).padStart(2, '0')), createdAt }
    await h.store.create(order, 'key-' + index, 'buyer')
    expected.push(order)
  }
  expected.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt) || (a.id < b.id ? -1 : 1))
  const seen = []
  for (const [page, hasMore, size] of [[1, true, 10], [2, true, 10], [3, false, 3]]) {
    const result = await mine(h, 'buyer', `?page=${page}&pageSize=10`)
    assert.equal(result.total, 23)
    assert.equal(result.page, page)
    assert.equal(result.hasMore, hasMore)
    assert.equal(result.orders.length, size)
    seen.push(...result.orders.map(order => order.id))
  }
  assert.deepEqual(seen, expected.map(order => order.id))
  assert.deepEqual((await mine(h, 'buyer', '?page=1&pageSize=10')).orders.map(o => o.id), seen.slice(0, 10), 'Repetir la consulta no cambia el orden')
  const beyond = await mine(h, 'buyer', '?page=9&pageSize=10')
  assert.deepEqual([beyond.orders, beyond.total, beyond.hasMore], [[], 23, false])
  const clamped = await mine(h, 'buyer', '?pageSize=999')
  assert.equal(clamped.pageSize, ORDER_HISTORY_MAX_PAGE_SIZE)
  assert.equal(clamped.orders.length, 23)
})

test('compatibilidad histórica: V1 propia con sucursal null y Orders sin propietario excluidas', { timeout: 10000 }, async t => {
  const h = await environment(t)
  await h.store.create(orderFixture('v1-owned'), 'v1-key', 'buyer')
  await h.store.create(orderFixture('legacy-orphan'), 'orphan-key')
  const page = await mine(h, 'buyer')
  assert.deepEqual(page.orders.map(order => order.id), ['v1-owned'])
  assert.equal(page.orders[0].branchId, null)
  assert.equal(page.orders[0].contractVersion, 1)
  const detail = await (await h.request('/api/v2/orders/v1-owned', 'buyer')).json()
  assert.equal(detail.commercial, undefined, 'No se completa información comercial inexistente')
  await expectError(await h.request('/api/v2/orders/legacy-orphan', 'buyer'), 404, 'ORDER_NOT_FOUND')
})

test('detalle autorizado, ajeno e inexistente; /mine no se interpreta como Order ID', { timeout: 10000 }, async t => {
  const h = await environment(t)
  const order = await h.create('buyer', 'detail')
  assert.deepEqual(await (await h.request('/api/v2/orders/' + order.id, 'buyer')).json(), order)
  const foreign = await expectError(await h.request('/api/v2/orders/' + order.id, 'other'), 404, 'ORDER_NOT_FOUND')
  const missing = await expectError(await h.request('/api/v2/orders/does-not-exist', 'buyer'), 404, 'ORDER_NOT_FOUND')
  assert.deepEqual(foreign, missing)
  const findById = t.mock.method(h.store, 'findById')
  await expectError(await h.request('/api/v2/orders/mine', 'admin'), 403, 'FORBIDDEN')
  assert.equal(findById.mock.callCount(), 0)
})

test('las consultas reflejan el estado de Payment y no modifican Orders', { timeout: 10000 }, async t => {
  const h = await environment(t)
  const order = await h.create('buyer', 'paid')
  const payment = await h.request('/api/orders/' + order.id + '/payment', 'buyer', { scenario: 'PAYMENT_APPROVED', idempotencyKey: 'p1' })
  assert.equal(payment.status, 200)
  const update = t.mock.method(h.store, 'update')
  const before = await h.store.findById(order.id)
  const [summary] = (await mine(h, 'buyer')).orders
  assert.equal(summary.orderStatus, 'CONFIRMED')
  assert.equal(summary.paymentStatus, 'APPROVED')
  await h.request('/api/v2/orders/' + order.id, 'buyer')
  assert.equal(update.mock.callCount(), 0)
  assert.deepEqual(await h.store.findById(order.id), before)
})
