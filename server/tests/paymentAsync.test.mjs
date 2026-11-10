/** Lecturas demoradas y fallos de escritura con In-Memory; no ejerce Payment Recovery de CN-59. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { InMemoryOrderStore } from '../dist/stores/orderStore.js'
import { OrderService } from '../dist/services/orderService.js'
import { PaymentService } from '../dist/services/paymentService.js'
import { OrderPersistenceError } from '../dist/domain/orderPersistenceError.js'

const user = { id: 'owner', displayName: 'Cliente', role: 'B2C' }
const request = { buyer: { fullName: 'Cliente', email: 'test@example.com', phone: '88888888' },
  delivery: { province: 'San José', canton: 'Central', address: 'Ficticia' }, items: [{ productId: 'p', quantity: 1 }],
  idempotencyKey: 'create', termsAcceptance: { accepted: true, version: '2026-10-lab4-v1' } }
async function fixture() {
  const store = new InMemoryOrderStore()
  const orders = new OrderService(store, async id => ({ objectID: id, title: 'Producto', price: 10000, in_stock: true, stock_quantity: 10 }))
  return { store, order: await orders.create(request, user) }
}

test('lectura PENDING demorada no permite pagar otra vez después de la aprobación concurrente', async t => {
  const { store, order } = await fixture()
  let release, entered, resume, calls = 0
  const gate = new Promise(resolve => { release = resolve }), started = new Promise(resolve => { entered = resolve })
  const service = new PaymentService(store, { process: async () => { calls++; entered(); await gate; return { result: 'PAYMENT_APPROVED' } } })
  const first = service.process(order.id, { scenario: 'PAYMENT_APPROVED', idempotencyKey: 'first' }, user.id)
  await started
  const find = store.findByIdForOwner.bind(store)
  let delayed = true
  t.mock.method(store, 'findByIdForOwner', async (...args) => {
    if (delayed) { delayed = false; await new Promise(resolve => { resume = resolve }); return structuredClone(order) }
    return find(...args)
  })
  const second = service.process(order.id, { scenario: 'PAYMENT_APPROVED', idempotencyKey: 'second' }, user.id)
  release(); await first; resume()
  await assert.rejects(second, { code: 'ORDER_ALREADY_CONFIRMED' })
  assert.equal(calls, 1)
  assert.equal((await find(order.id, user.id)).orderStatus, 'CONFIRMED')
})

test('fallo de escritura no cachea el resultado; una Order ya confirmada impide ejecutar nuevamente Sandbox', async t => {
  const { store, order } = await fixture()
  let calls = 0
  const service = new PaymentService(store, { process: async () => { calls++; return { result: 'PAYMENT_APPROVED' } } })
  const update = store.update.bind(store)
  t.mock.method(store, 'update', async (...args) => { await update(...args); throw new OrderPersistenceError('unknown') })
  const attempt = { scenario: 'PAYMENT_APPROVED', idempotencyKey: 'attempt' }
  await assert.rejects(service.process(order.id, attempt, user.id), { status: 503, outcome: 'unknown' })
  await assert.rejects(service.process(order.id, attempt, 'other'), { status: 404 })
  await assert.rejects(service.process(order.id, attempt, user.id), { code: 'ORDER_ALREADY_CONFIRMED' })
  assert.equal(calls, 1)
  assert.equal(service.results.size, 0)
  assert.equal(service.paymentLocks.size, 0)
})
