/** Compra como invitado: identidad B2C temporal sin Session, con Ownership, Payment y RBAC reales sobre Algolia simulado. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { QA_ALGOLIA_ENV, QA_USERS, createFakeAlgoliaCatalog } from './helpers/fakeAlgoliaCatalog.mjs'

Object.assign(process.env, QA_ALGOLIA_ENV)
const { default: app } = await import('../dist/app.js')
const { getAlgoliaClient } = await import('../dist/config/algolia.js')
const { userService } = await import('../dist/services/userService.js')
const { paymentService } = await import('../dist/services/paymentService.js')

const guestId = () => 'guest-' + randomUUID()
/** Orden V2 B2C a precio Retail del catálogo QA; el Server recalcula importes y valida inventario. */
const body = (key = randomUUID()) => ({
  buyer: { fullName: 'Persona Invitada', email: 'invitada@example.com', phone: '88888888' },
  delivery: { province: 'San José', canton: 'Central', address: 'Dirección de prueba' },
  items: [{ productId: 'qa-ssd-1tb', quantity: 1 }], idempotencyKey: key, branchId: 'san_jose',
  termsAcceptance: { accepted: true, version: '2026-10-lab4-v1' },
})

async function setup(t) {
  const catalog = createFakeAlgoliaCatalog()
  const algolia = getAlgoliaClient()
  t.mock.method(algolia, 'searchSingleIndex', catalog.searchSingleIndex)
  t.mock.method(algolia, 'getObject', catalog.getObject)
  const find = t.mock.method(userService.directory, 'find', async id => QA_USERS.find(record => record.objectID === id))
  t.mock.method(paymentService.sandbox, 'process', async request => ({ result: request.scenario }))
  const server = app.listen(0, '127.0.0.1')
  await new Promise(resolve => server.once('listening', resolve))
  t.after(() => new Promise(resolve => server.close(resolve)))
  const base = 'http://127.0.0.1:' + server.address().port
  const call = async (path, headers = {}, init = {}) => {
    const response = await fetch(base + path, { ...init, headers: { 'Content-Type': 'application/json', ...headers } })
    return { status: response.status, body: await response.json().catch(() => null) }
  }
  return { call, find }
}

test('invitado: crea la Order V2 B2C Retail, paga y la consulta sin iniciar sesión', async t => {
  const { call, find } = await setup(t)
  const guest = guestId()
  const headers = { 'X-CiberNova-Guest-Id': guest }
  const created = await call('/api/v2/orders', headers, { method: 'POST', body: JSON.stringify(body()) })
  assert.equal(created.status, 201)
  assert.deepEqual([created.body.commercial.userId, created.body.commercial.customerRole, created.body.commercial.pricingType], [guest, 'B2C', 'RETAIL'])
  assert.equal(created.body.totals.subtotal, 45000)
  assert.equal(find.mock.callCount(), 0, 'El invitado no consulta el directorio de usuarios')
  const paid = await call(`/api/orders/${created.body.id}/payment`, headers, { method: 'POST', body: JSON.stringify({ scenario: 'PAYMENT_APPROVED', idempotencyKey: randomUUID() }) })
  assert.equal(paid.status, 200)
  assert.deepEqual([paid.body.order.orderStatus, paid.body.order.paymentStatus], ['CONFIRMED', 'APPROVED'])
  assert.equal((await call('/api/v2/orders/' + created.body.id, headers)).body.orderStatus, 'CONFIRMED')
  // Replay idempotente con la misma clave y el mismo invitado.
  const key = randomUUID()
  const first = await call('/api/v2/orders', headers, { method: 'POST', body: JSON.stringify(body(key)) })
  const replay = await call('/api/v2/orders', headers, { method: 'POST', body: JSON.stringify(body(key)) })
  assert.equal(replay.body.id, first.body.id)
})

test('invitado: Ownership aislado, sin permisos administrativos ni B2B, y ADMIN ve su Order como Invitado', async t => {
  const { call } = await setup(t)
  const owner = guestId()
  const created = await call('/api/v2/orders', { 'X-CiberNova-Guest-Id': owner }, { method: 'POST', body: JSON.stringify(body()) })
  assert.equal(created.status, 201)
  assert.equal((await call('/api/v2/orders/' + created.body.id, { 'X-CiberNova-Guest-Id': guestId() })).status, 404)
  assert.equal((await call('/api/v2/orders/' + created.body.id, { 'X-CiberNova-User-Id': 'qa-b2c' })).status, 404)
  const payByOther = await call(`/api/orders/${created.body.id}/payment`, { 'X-CiberNova-Guest-Id': guestId() },
    { method: 'POST', body: JSON.stringify({ scenario: 'PAYMENT_APPROVED', idempotencyKey: randomUUID() }) })
  assert.equal(payByOther.status, 404)
  for (const path of ['/api/v2/admin/orders', '/api/v2/admin/products']) {
    assert.equal((await call(path, { 'X-CiberNova-Guest-Id': owner })).status, 403, path)
  }
  const listed = await call('/api/v2/admin/orders?orderId=' + created.body.id, { 'X-CiberNova-User-Id': 'qa-admin' })
  assert.deepEqual([listed.body.orders[0].userId, listed.body.orders[0].displayName, listed.body.orders[0].customerRole], [owner, 'Invitado', 'B2C'])
})

test('identidad de invitado inválida o combinada se rechaza; sin ninguna identidad sigue siendo obligatoria', async t => {
  const { call } = await setup(t)
  for (const headers of [{ 'X-CiberNova-Guest-Id': 'guest-123' }, { 'X-CiberNova-Guest-Id': 'qa-b2c' }, { 'X-CiberNova-Guest-Id': 'GUEST-' + randomUUID() },
    { 'X-CiberNova-Guest-Id': guestId(), 'X-CiberNova-User-Id': 'qa-b2c' }, { 'X-CiberNova-User-Id': guestId() }]) {
    const response = await call('/api/v2/orders', headers, { method: 'POST', body: JSON.stringify(body()) })
    assert.deepEqual([response.status, response.body.error.code], [400, 'INVALID_USER_ID'], JSON.stringify(headers))
  }
  const anonymous = await call('/api/v2/orders', {}, { method: 'POST', body: JSON.stringify(body()) })
  assert.deepEqual([anonymous.status, anonymous.body.error.code], [401, 'IDENTITY_REQUIRED'])
})
