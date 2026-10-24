/** Verifica stock, identidad de creación y cálculos con módulos aislados, sin importar configuración ni contactar Algolia. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { stripTypeScriptTypes } from 'node:module'

// Compila únicamente estos módulos puros en memoria. Nunca importa app, env o Algolia.
const sources = new Map()
/** Codifica el código recibido como módulo importable en memoria. */
const dataUrl = source => 'data:text/javascript;base64,' + Buffer.from(source).toString('base64')
sources.set('services/productService', dataUrl('export async function getProductById() { throw new Error("Debe inyectarse el catálogo simulado") }'))
for (const name of ['domain/termsPolicy', 'domain/orderError', 'domain/orderValidation', 'domain/orderCalculations', 'stores/orderStore', 'domain/paymentValidation', 'services/paymentSandboxService', 'services/paymentService', 'services/orderService']) {
  const source = readFileSync(new URL('../src/' + name + '.ts', import.meta.url), 'utf8')
  const compiled = stripTypeScriptTypes(source, { mode: 'transform' })
  const isolated = compiled.replace(/from ['"](\.[^'"]+)['"]/g, (_, path) => {
    const resolved = new URL(path, 'https://local/' + name + '.js').pathname.slice(1).replace(/\.js$/, '')
    assert.ok(sources.has(resolved), 'Dependencia no autorizada: ' + resolved)
    return 'from ' + JSON.stringify(sources.get(resolved))
  })
  sources.set(name, dataUrl(isolated))
}
const { OrderService } = await import(sources.get('services/orderService'))
const { InMemoryOrderStore } = await import(sources.get('stores/orderStore'))
const { PaymentService } = await import(sources.get('services/paymentService'))
const { calculateOrderTotals } = await import(sources.get('domain/orderCalculations'))
/** Construye una solicitud de compra con datos y clave de idempotencia de prueba. */
const request = () => ({
  termsAcceptance: {accepted:true, version:'2026-10-lab4-v1'},
  buyer: { fullName: ' Usuario ', email: 'user@example.com', phone: '88888888' },
  delivery: { province: 'San José', canton: 'Central', address: 'Dirección' },
  items: [{ productId: 'p', quantity: 1 }], idempotencyKey: 'creation',
})
const product = { objectID: 'p', title: 'Producto', image_url: '', price: 10000, in_stock: true, stock_quantity: 3 }
/** Crea un store y un servicio de Orders con la consulta de productos simulada recibida. */
const setup = (lookup = async id => ({ ...product, objectID: id })) => {
  const store = new InMemoryOrderStore()
  return { store, service: new OrderService(store, lookup) }
}
/** Reconoce el error público de validación esperado por los casos de entrada inválida. */
const invalid = error => error.status === 400 && error.code === 'CHECKOUT_VALIDATION_ERROR'
/** Reconoce el conflicto de identidad asociado a una clave de idempotencia reutilizada. */
const conflict = error => error.status === 409 && error.code === 'CHECKOUT_VALIDATION_ERROR' && Boolean(error.fieldErrors.idempotencyKey)

for (const [name, overrides, quantity] of [
  ['fuera de stock', { in_stock: false }, 1],
  ['stock cero', { stock_quantity: 0 }, 1],
  ['stock insuficiente', {}, 4],
  ['disponibilidad desconocida', { in_stock: undefined }, 1],
  ['booleano inválido', { in_stock: 'true' }, 1],
  ...[undefined, null, '3', -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1].map(stock_quantity => ['stock inválido ' + String(stock_quantity), { stock_quantity }, 1]),
]) {
  test('F1 rechaza ' + name + ' sin almacenar', async () => {
    const { store, service } = setup(async () => ({ ...product, ...overrides }))
    const input = request()
    input.items[0] = { productId: 'p', quantity, in_stock: true, stock_quantity: 100 }
    await assert.rejects(service.create(input), invalid)
    assert.equal(store.findByIdempotencyKey(input.idempotencyKey), undefined)
  })
}
test('F1 acepta disponibilidad suficiente y exacta; agrega líneas repetidas', async () => {
  for (const quantities of [[1], [3], [1, 2]]) {
    const { service } = setup()
    const input = request()
    input.items = quantities.map(quantity => ({ productId: 'p', quantity }))
    assert.equal((await service.create(input)).items.reduce((sum, item) => sum + item.quantity, 0), quantities.reduce((sum, value) => sum + value, 0))
  }
  const { store, service } = setup()
  const input = request()
  input.items = [{ productId: 'p', quantity: 2 }, { productId: 'p', quantity: 2 }]
  await assert.rejects(service.create(input), invalid)
  assert.equal(store.findByIdempotencyKey(input.idempotencyKey), undefined)
})
test('F1 no almacena orden parcial si falla un producto posterior', async () => {
  const { store, service } = setup(async id => ({ ...product, objectID: id, in_stock: id === 'p' }))
  const input = request()
  input.items.push({ productId: 'q', quantity: 1 })
  await assert.rejects(service.create(input), invalid)
  assert.equal(store.findByIdempotencyKey(input.idempotencyKey), undefined)
})
test('F1 rechaza desbordamiento de cantidades agregadas antes del catálogo', async () => {
  const { service } = setup(async () => assert.fail('No consultar'))
  await assert.rejects(service.create({ ...request(), items: [{ productId: 'p', quantity: Number.MAX_SAFE_INTEGER }, { productId: 'p', quantity: 1 }] }), invalid)
})

test('F2 replay normalizado conserva una sola orden y tolera orden de propiedades/líneas', async () => {
  let calls = 0
  const { service, store } = setup(async id => { calls++; return { ...product, objectID: id } })
  const input = request()
  input.items.push({ productId: 'q', quantity: 1 })
  const first = await service.create(input)
  const equivalent = { ...input, buyer: { phone: '88888888 ', email: ' user@example.com ', fullName: 'Usuario' }, delivery: { address: 'Dirección ', canton: 'Central', province: 'San José', additionalInfo: ' ' }, items: [...input.items].reverse() }
  assert.deepEqual(await service.create(equivalent), first)
  assert.equal(calls, 2)
  // La identidad sobrevive a otra instancia del servicio y cambios de estado en el Store.
  store.update({ ...first, orderStatus: 'CONFIRMED', paymentStatus: 'APPROVED' })
  const replay = await new OrderService(store, async () => assert.fail('No consultar')).create(equivalent)
  assert.equal(replay.id, first.id)
  assert.equal(replay.orderStatus, 'CONFIRMED')
})
for (const [name, change] of [
  ['buyer', input => { input.buyer.fullName = 'Otro' }],
  ['delivery', input => { input.delivery.address = 'Otra dirección' }],
  ['cantidad', input => { input.items[0].quantity = 2 }],
]) {
  test('F2 rechaza cambio de ' + name + ' completo y pendiente', async () => {
    let release
    const gate = new Promise(resolve => { release = resolve })
    let calls = 0
    const { service, store } = setup(async () => { calls++; await gate; return product })
    const original = request()
    const first = service.create(original)
    const changed = request()
    change(changed)
    try { await assert.rejects(service.create(changed), conflict) }
    finally { release() }
    const order = await first
    await assert.rejects(service.create(changed), conflict)
    assert.deepEqual(store.findById(order.id), order)
    assert.equal(calls, 1)
  })
}
test('F2 comparte concurrentes compatibles y libera pending tras fallo', async () => {
  let calls = 0
  let fail = true
  const { store, service } = setup(async () => { calls++; if (fail) throw new Error('fixture failure'); return product })
  const failed = await Promise.allSettled([service.create(request()), service.create(request())])
  assert.ok(failed.every(result => result.status === 'rejected'))
  assert.equal(calls, 1)
  assert.equal(store.findByIdempotencyKey('creation'), undefined)
  fail = false
  const changed = request()
  changed.items[0].quantity = 2
  const orders = await Promise.all(Array.from({ length: 10 }, () => service.create(changed)))
  assert.equal(new Set(orders.map(order => order.id)).size, 1)
  assert.equal(calls, 2)
  assert.equal((await service.create(changed)).id, orders[0].id)
  assert.notEqual((await service.create({ ...changed, idempotencyKey: 'new' })).id, orders[0].id)
})

for (const [prices, shipping] of [
  [[0], 0], [[50000], 3500], [[99999], 3500], [[99999.01], 3500],
  [[99999.49], 3500], [[99999.50], 0], [[99999.99], 0],
  [[99999.995], 0], [[99999.999999], 0], [[100000], 0], [[100000.01], 0], [[150000], 0],
  [[60000, 39999.49], 3500], [[60000, 39999.50], 0], [[49999.49, 50000.49], 0],
  [[60000, 39999.995], 0], [[60000, 40000], 0],
]) {
  test('F3 precios sin normalizar ' + prices.join(' + '), async () => {
    const { service } = setup(async id => ({ ...product, objectID: id, price: prices[Number(id)] }))
    const input = { ...request(), items: prices.map((_, index) => ({ productId: String(index), quantity: 1 })) }
    const order = await service.create(input)
    assert.deepEqual(order.items.map(item => item.unitPrice), prices)
    assert.deepEqual(order.items.map(item => item.lineSubtotal), prices)
    assert.equal(order.totals.subtotal, prices.reduce((sum, price) => sum + price, 0))
    assert.equal(order.totals.shipping, shipping)
    assert.equal(order.totals.tax, Math.round(order.totals.subtotal * 100 * 0.13) / 100)
    assert.equal(order.totals.total, order.totals.subtotal + order.totals.tax + shipping)
  })
}
test('F3 preserva precisión antes de multiplicar y rechaza importes inválidos', async () => {
  const { service } = setup(async () => ({ ...product, price: 49999.9975 }))
  const input = request()
  input.items[0].quantity = 2
  const order = await service.create(input)
  assert.equal(order.items[0].lineSubtotal, 99999.995)
  assert.equal(order.items[0].unitPrice, 49999.9975)
  assert.equal(order.totals.subtotal, 99999.995)
  assert.equal(order.totals.shipping, 0)
  assert.equal(order.totals.total, order.totals.subtotal + order.totals.tax)
  for (const lineSubtotal of [NaN, Infinity, -1, Number.MAX_SAFE_INTEGER]) {
    assert.throws(() => calculateOrderTotals([{ lineSubtotal }]), invalid)
  }
})

test('CN-30 mantiene estados, replay, autoridad y bloqueo con órdenes corregidas', async () => {
  const { service, store } = setup()
  const order = await service.create(request())
  const payments = new PaymentService(store)
  for (const [scenario, status] of [['PAYMENT_ERROR', 'ERROR'], ['PAYMENT_DECLINED', 'DECLINED'], ['PAYMENT_APPROVED', 'APPROVED']]) {
    const input = { scenario, idempotencyKey: scenario, amount: 1, currency: 'USD' }
    const active = payments.process(order.id, input)
    await assert.rejects(payments.process(order.id, { ...input, idempotencyKey: 'parallel' }), error => error.code === 'PAYMENT_IN_PROGRESS')
    const result = await active
    assert.equal(result.order.paymentStatus, status)
    assert.equal(result.order.orderStatus, status === 'APPROVED' ? 'CONFIRMED' : 'PENDING')
    assert.deepEqual(result.order.totals, order.totals)
    assert.deepEqual(service.findById(order.id), result.order)
    assert.deepEqual(await payments.process(order.id, input), result)
  }
  await assert.rejects(payments.process(order.id, { scenario: 'PAYMENT_APPROVED', idempotencyKey: 'new' }), error => error.code === 'ORDER_ALREADY_CONFIRMED')
  assert.equal((await service.create(request())).orderStatus, 'CONFIRMED')
})
