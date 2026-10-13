import test from 'node:test'
import assert from 'node:assert/strict'
import app from '../dist/app.js'
import { OrderService, orderService } from '../dist/services/orderService.js'
import { InMemoryOrderStore } from '../dist/stores/orderStore.js'
import { calculateOrderTotals } from '../dist/domain/orderCalculations.js'

const request = (key = 'purchase-1') => ({
  buyer: { fullName: ' Usuario Prueba ', email: 'usuario@example.com', phone: '88888888' },
  delivery: { province: 'San José', canton: 'San José', address: 'Dirección de prueba' },
  items: [{ productId: 'product-1', quantity: 2 }], idempotencyKey: key,
})
const product = { objectID: 'product-1', title: 'Producto real', image_url: '/image.jpg', price: 10000, in_stock: true, stock_quantity: 3 }

test('snapshot autoritativo, consulta, estados y aislamiento del store', async () => {
  const store = new InMemoryOrderStore()
  const service = new OrderService(store, async () => product)
  const input = request()
  input.items[0].unitPrice = 1
  input.totals = { total: 1 }
  const order = await service.create(input)
  assert.deepEqual(order.totals, { subtotal: 20000, tax: 2600, shipping: 3500, total: 26100 })
  assert.deepEqual(order.items[0], { productId: 'product-1', name: 'Producto real', image: '/image.jpg', unitPrice: 10000, quantity: 2, lineSubtotal: 20000 })
  assert.equal(order.currency, 'CRC')
  assert.equal(order.orderStatus, 'PENDING')
  assert.equal(order.paymentStatus, 'PENDING')
  assert.equal(order.buyer.fullName, 'Usuario Prueba')
  assert.ok(order.id && order.orderNumber.startsWith('CN-') && Number.isFinite(Date.parse(order.createdAt)))
  assert.deepEqual(service.findById(order.id), order)
  assert.deepEqual(await service.create(request()), order)
  order.items[0].name = 'Mutación'
  assert.equal(service.findById(order.id).items[0].name, 'Producto real')
  const updated = service.findById(order.id)
  updated.paymentStatus = 'APPROVED'
  store.update(updated)
  assert.equal(service.findById(order.id).paymentStatus, 'APPROVED')
  assert.equal(service.findById(order.id).orderStatus, 'PENDING')
  assert.equal(store.update({ ...updated, id: 'missing' }), undefined)
})

test('idempotencia simultánea y recuperación después de un fallo', async () => {
  let calls = 0
  let fail = true
  const service = new OrderService(new InMemoryOrderStore(), async () => {
    calls++
    await new Promise(resolve => setTimeout(resolve, 5))
    if (fail) throw new Error('catalog unavailable')
    return product
  })
  const failed = await Promise.allSettled([service.create(request()), service.create(request())])
  assert.ok(failed.every(result => result.status === 'rejected'))
  assert.equal(calls, 1)
  fail = false
  const orders = await Promise.all(Array.from({ length: 10 }, () => service.create(request())))
  assert.equal(new Set(orders.map(order => order.id)).size, 1)
  assert.equal(calls, 2)
  assert.equal((await service.create(request())).id, orders[0].id)
  assert.notEqual((await service.create(request('another-key'))).id, orders[0].id)
})

test('shipping en cero y alrededor del umbral; IVA y centavos', () => {
  for (const [subtotal, shipping] of [[0, 0], [99999.49, 3500], [99999.50, 0], [99999.99, 0], [100000, 0], [100000.01, 0]]) {
    const totals = calculateOrderTotals([{ lineSubtotal: subtotal }])
    assert.equal(totals.subtotal, subtotal)
    assert.equal(totals.shipping, shipping)
    assert.equal(totals.tax, Math.round(subtotal * 100 * 0.13) / 100)
  }
  assert.deepEqual(calculateOrderTotals([{ lineSubtotal: 0.1 }, { lineSubtotal: 0.2 }]), { subtotal: 0.1 + 0.2, tax: 0.04, shipping: 3500, total: (0.1 + 0.2) + 0.04 + 3500 })
})

test('validaciones impiden consultar catálogo y admiten solamente cantidades enteras positivas', async () => {
  const service = new OrderService(new InMemoryOrderStore(), async () => { assert.fail('No debe consultar catálogo') })
  const cases = [undefined, null, [], {}, { ...request(), buyer: null }, { ...request(), buyer: { ...request().buyer, email: 'invalid' } }, { ...request(), buyer: { ...request().buyer, phone: 'abcd' } }, { ...request(), delivery: { ...request().delivery, address: '' } }, { ...request(), delivery: { ...request().delivery, additionalInfo: 1 } }, { ...request(), idempotencyKey: '' }, { ...request(), items: null }, { ...request(), items: [] }, ...[0, -1, 1.5, '2', NaN, Infinity, Number.MAX_SAFE_INTEGER + 1].map(quantity => ({ ...request(), items: [{ productId: 'product-1', quantity }] })), { ...request(), items: [null] }]
  for (const value of cases) await assert.rejects(service.create(value), error => error.status === 400)
})

test('producto inexistente, precio inválido y orden inexistente producen errores controlados', async () => {
  const service = new OrderService(new InMemoryOrderStore(), async () => undefined)
  await assert.rejects(service.create(request()), error => error.code === 'PRODUCT_NOT_FOUND' && error.status === 404)
  assert.throws(() => service.findById('missing'), error => error.code === 'ORDER_NOT_FOUND')
  for (const price of [undefined, -1, NaN, Infinity]) {
    const invalid = new OrderService(new InMemoryOrderStore(), async () => ({ ...product, price }))
    await assert.rejects(invalid.create(request()), error => error.code === 'UNEXPECTED_ERROR' && error.status === 503)
  }
})

test('API: POST 201, GET 200, errores del contrato, JSON inválido y CORS', async () => {
  // Sustituye solo la frontera del catálogo; ejercita routes, controllers, service y store reales.
  const original = orderService.lookup
  orderService.lookup = async id => id === product.objectID ? product : undefined
  const server = app.listen(0, '127.0.0.1')
  await new Promise(resolve => server.once('listening', resolve))
  const base = 'http://127.0.0.1:' + server.address().port + '/api/orders'
  const post = (body) => fetch(base, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  try {
    const created = await post(request('http-test'))
    assert.equal(created.status, 201)
    const order = await created.json()
    const get = await fetch(base + '/' + order.id)
    assert.equal(get.status, 200)
    assert.deepEqual(await get.json(), order)
    assert.equal((await (await post(request('http-test'))).json()).id, order.id)
    for (const [response, status, code] of [
      [await fetch(base + '/missing'), 404, 'ORDER_NOT_FOUND'],
      [await post({ ...request('missing-product'), items: [{ productId: 'missing', quantity: 1 }] }), 404, 'PRODUCT_NOT_FOUND'],
      [await post({ ...request(), items: [] }), 400, 'EMPTY_CART'],
      [await fetch(base, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' }), 400, 'CHECKOUT_VALIDATION_ERROR'],
      [await fetch(base, { method: 'POST' }), 400, 'CHECKOUT_VALIDATION_ERROR'],
    ]) {
      assert.equal(response.status, status)
      const body = await response.json()
      assert.equal(body.error.code, code)
      assert.equal(body.error.stack, undefined)
    }
    orderService.lookup = async () => { throw new Error('SECRET_INTERNAL_DETAIL') }
    const failure = await post(request('catalog-failure'))
    assert.equal(failure.status, 500)
    assert.equal((await failure.json()).error.code, 'UNEXPECTED_ERROR')
    const preflight = await fetch(base, { method: 'OPTIONS', headers: { Origin: 'http://localhost:5173', 'Access-Control-Request-Method': 'POST' } })
    assert.ok(preflight.headers.get('access-control-allow-methods').includes('POST'))
  } finally {
    orderService.lookup = original
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  }
})
