/** CN-63 Order Ownership y Payment Authorization por HTTP con UserService real, directorio ficticio y stores In-Memory. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { serverConfig } from '../dist/config/env.js'
import { orderService } from '../dist/services/orderService.js'
import { paymentService } from '../dist/services/paymentService.js'
import { userService } from '../dist/services/userService.js'
import { InMemoryOrderStore } from '../dist/stores/orderStore.js'
import { InMemoryPaymentStore } from '../dist/stores/paymentStore.js'
import { ROLE_PERMISSIONS, canReadOrder, hasPermission, orderReadScope, requirePaymentActor } from '../dist/domain/orderAccess.js'
import { mockUserDirectory } from './helpers/identity.mjs'

serverConfig.clientOrigin = 'https://rajami1205.github.io'
const { default: app } = await import('../dist/app.js')

const users = {
  buyer: { id: 'buyer', displayName: 'Cliente', role: 'B2C' },
  other: { id: 'other', displayName: 'Otro cliente', role: 'B2C' },
  business: { id: 'business', displayName: 'Compras', role: 'B2B', company: { id: 'co', name: 'Empresa ficticia' } },
  partner: { id: 'partner', displayName: 'Otra empresa', role: 'B2B', company: { id: 'co2', name: 'Otra empresa ficticia' } },
  admin: { id: 'admin', displayName: 'Administración', role: 'ADMIN' },
}
const orderInput = (key, quantity = 1) => ({ buyer: { fullName: 'Prueba', email: 'test@example.com', phone: '88888888' },
  delivery: { province: 'San José', canton: 'Central', address: 'Ficticia' }, items: [{ productId: 'p', quantity }],
  idempotencyKey: key, branchId: 'san_jose', termsAcceptance: { accepted: true, version: '2026-10-lab4-v1' } })
const payment = (scenario, key = scenario) => ({ scenario, idempotencyKey: key })
const product = id => ({ objectID: id, title: 'Producto', price: 10000, in_stock: true, stock_quantity: 10,
  b2b: { available: true, wholesale_price: 8000, min_order_quantity: 3 }, stock_by_branch: { san_jose: 10 } })

/** Servidor loopback con stores aislados; solo se sustituyen catálogo, Sandbox y directorio de usuarios. */
async function environment(t) {
  const records = [...Object.values(users).map(user => ({ objectID: user.id, displayName: user.displayName, role: user.role, enabled: true,
    ...(user.company ? { company: user.company } : {}) })), { objectID: 'off', displayName: 'Off', role: 'B2C', enabled: false },
  { objectID: 'bad-role', displayName: 'Bad', role: 'GUEST', enabled: true }]
  mockUserDirectory(t, records)
  const previous = { orders: orderService.store, payments: paymentService.store, persistence: paymentService.persistence }
  const store = new InMemoryOrderStore()
  orderService.store = store
  paymentService.store = store
  paymentService.persistence = new InMemoryPaymentStore(store)
  t.after(() => { orderService.store = previous.orders; paymentService.store = previous.payments; paymentService.persistence = previous.persistence })
  t.mock.method(orderService, 'lookup', async id => product(id))
  const sandbox = t.mock.method(paymentService.sandbox, 'process', async request => ({ result: request.scenario }))
  const resolve = t.mock.method(userService, 'resolve')
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
    const response = await request('/api/v2/orders', id, orderInput(key, id === 'business' || id === 'partner' ? 3 : 1))
    assert.equal(response.status, 201)
    return response.json()
  }
  return { store, sandbox, resolve, request, create, records }
}

async function expectError(response, status, code) {
  assert.equal(response.status, status)
  const body = await response.json()
  assert.equal(body.error.code, code)
  assert.equal(body.error.stack, undefined)
  return body
}

test('matriz RBAC central: compradores compran y leen lo propio; ADMIN solo consulta global', () => {
  assert.deepEqual(ROLE_PERMISSIONS.B2C, ['checkout:create', 'orders:read:own'])
  assert.deepEqual(ROLE_PERMISSIONS.B2B, ['checkout:create', 'orders:read:own'])
  assert.deepEqual(ROLE_PERMISSIONS.ADMIN, ['orders:read:all'])
  assert.ok(Object.isFrozen(ROLE_PERMISSIONS) && Object.isFrozen(ROLE_PERMISSIONS.ADMIN))
  assert.equal(hasPermission(users.admin, 'checkout:create'), false)
  assert.deepEqual(orderReadScope(users.buyer), { kind: 'own', ownerId: 'buyer' })
  assert.deepEqual(orderReadScope(users.business), { kind: 'own', ownerId: 'business' })
  assert.deepEqual(orderReadScope(users.admin), { kind: 'all' })
  assert.equal(requirePaymentActor(users.business), 'business')
  assert.throws(() => requirePaymentActor(users.admin), { status: 403, code: 'FORBIDDEN' })
})

test('canReadOrder usa el owner almacenado y nunca concede Orders sin propietario a compradores', () => {
  assert.equal(canReadOrder(users.buyer, 'buyer'), true)
  assert.equal(canReadOrder(users.buyer, 'other'), false)
  assert.equal(canReadOrder(users.business, 'business'), true)
  assert.equal(canReadOrder(users.business, 'buyer'), false)
  for (const legacyOwner of [undefined, null, '']) {
    assert.equal(canReadOrder(users.buyer, legacyOwner), false)
    assert.equal(canReadOrder(users.admin, legacyOwner), true, 'Consulta administrativa histórica documentada')
  }
  assert.equal(canReadOrder(users.admin, 'buyer'), true)
})

test('B2C y B2B consultan sus Orders por V2 y legacy, pero no las de otros compradores', { timeout: 10000 }, async t => {
  const h = await environment(t)
  const orders = { buyer: await h.create('buyer', 'k-buyer'), business: await h.create('business', 'k-business') }
  for (const [owner, intruders] of [['buyer', ['other', 'business']], ['business', ['partner', 'buyer']]]) {
    const order = orders[owner]
    for (const path of ['/api/v2/orders/', '/api/orders/']) {
      const own = await h.request(path + order.id, owner)
      assert.equal(own.status, 200)
      assert.deepEqual(await own.json(), order)
      for (const intruder of intruders) await expectError(await h.request(path + order.id, intruder), 404, 'ORDER_NOT_FOUND')
    }
  }
})

test('ADMIN consulta cualquier Order por V2; la ruta legacy queda reservada a compradores', { timeout: 10000 }, async t => {
  const h = await environment(t)
  for (const owner of ['buyer', 'business']) {
    const order = await h.create(owner, 'admin-read-' + owner)
    const response = await h.request('/api/v2/orders/' + order.id, 'admin')
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), order)
    await expectError(await h.request('/api/orders/' + order.id, 'admin'), 403, 'FORBIDDEN')
  }
  await expectError(await h.request('/api/v2/orders', 'admin', orderInput('admin-buy')), 403, 'FORBIDDEN')
})

test('ADMIN no puede procesar Payments ni Replay aunque pueda consultar la Order', { timeout: 10000 }, async t => {
  const h = await environment(t)
  const order = await h.create('buyer', 'admin-pay')
  const path = '/api/orders/' + order.id + '/payment'
  assert.equal((await h.request(path, 'buyer', payment('PAYMENT_DECLINED'))).status, 200)
  for (const body of [payment('PAYMENT_APPROVED', 'admin-key'), payment('PAYMENT_DECLINED')]) {
    await expectError(await h.request(path, 'admin', body), 403, 'FORBIDDEN')
  }
  assert.equal(h.sandbox.mock.callCount(), 1)
  assert.equal((await (await h.request('/api/v2/orders/' + order.id, 'admin')).json()).paymentStatus, 'DECLINED')
})

test('Payment, Retry y Replay solo para el propietario; una IdempotencyKey válida no omite la autorización', { timeout: 10000 }, async t => {
  const h = await environment(t)
  const order = await h.create('business', 'pay-owner')
  const path = '/api/orders/' + order.id + '/payment'
  await expectError(await h.request(path, 'partner', payment('PAYMENT_DECLINED')), 404, 'ORDER_NOT_FOUND')
  assert.equal(h.sandbox.mock.callCount(), 0, 'La autorización precede al Sandbox')
  const declined = await (await h.request(path, 'business', payment('PAYMENT_DECLINED'))).json()
  assert.equal(declined.result, 'PAYMENT_DECLINED')
  // Replay del propietario devuelve el histórico; la misma key desde otra identidad no lo expone.
  assert.deepEqual(await (await h.request(path, 'business', payment('PAYMENT_DECLINED'))).json(), declined)
  for (const intruder of ['partner', 'buyer']) {
    const denied = await expectError(await h.request(path, intruder, payment('PAYMENT_DECLINED')), 404, 'ORDER_NOT_FOUND')
    assert.doesNotMatch(JSON.stringify(denied), /PAYMENT_DECLINED|business|CN-/)
  }
  // Retry con nueva key: del propietario se procesa; de otra identidad se rechaza sin tocar el Sandbox.
  await expectError(await h.request(path, 'partner', payment('PAYMENT_APPROVED', 'retry')), 404, 'ORDER_NOT_FOUND')
  assert.equal(h.sandbox.mock.callCount(), 1)
  const approved = await (await h.request(path, 'business', payment('PAYMENT_APPROVED', 'retry'))).json()
  assert.equal(approved.order.orderStatus, 'CONFIRMED')
  assert.equal(h.sandbox.mock.callCount(), 2)
  // Una Order confirmada conserva su restricción para el propietario y no revela su estado a terceros.
  await expectError(await h.request(path, 'business', payment('PAYMENT_APPROVED', 'again')), 409, 'ORDER_ALREADY_CONFIRMED')
  await expectError(await h.request(path, 'partner', payment('PAYMENT_APPROVED', 'again')), 404, 'ORDER_NOT_FOUND')
  assert.equal(h.sandbox.mock.callCount(), 2)
})

test('Replay de creación V2 con la key de otro usuario no devuelve su Order', { timeout: 10000 }, async t => {
  const h = await environment(t)
  const order = await h.create('buyer', 'shared-key')
  const replay = await h.request('/api/v2/orders', 'buyer', orderInput('shared-key'))
  assert.deepEqual(await replay.json(), order)
  const intruder = await h.request('/api/v2/orders', 'other', orderInput('shared-key'))
  assert.equal(intruder.status, 201)
  const own = await intruder.json()
  assert.notEqual(own.id, order.id, 'La key se aísla por propietario; nunca devuelve la Order ajena')
  assert.equal(own.commercial.userId, 'other')
})

test('Order inexistente y Order ajena responden igual para no revelar información', { timeout: 10000 }, async t => {
  const h = await environment(t)
  const order = await h.create('buyer', 'same-answer')
  for (const path of ['/api/v2/orders/', '/api/orders/']) {
    const missing = await expectError(await h.request(path + 'does-not-exist', 'other'), 404, 'ORDER_NOT_FOUND')
    const foreign = await expectError(await h.request(path + order.id, 'other'), 404, 'ORDER_NOT_FOUND')
    assert.deepEqual(foreign, missing)
  }
  await expectError(await h.request('/api/v2/orders/does-not-exist', 'admin'), 404, 'ORDER_NOT_FOUND')
  const missingPayment = await expectError(await h.request('/api/orders/does-not-exist/payment', 'other', payment('PAYMENT_APPROVED')), 404, 'ORDER_NOT_FOUND')
  const foreignPayment = await expectError(await h.request('/api/orders/' + order.id + '/payment', 'other', payment('PAYMENT_APPROVED')), 404, 'ORDER_NOT_FOUND')
  assert.deepEqual(foreignPayment, missingPayment)
})

test('Session requerida, usuario inexistente, inactivo o inválido se rechazan antes de leer Orders', { timeout: 10000 }, async t => {
  const h = await environment(t)
  const order = await h.create('buyer', 'identity-checks')
  const findById = t.mock.method(h.store, 'findById')
  const findForOwner = t.mock.method(h.store, 'findByIdForOwner')
  for (const [id, status, code] of [[null, 401, 'IDENTITY_REQUIRED'], ['', 400, 'INVALID_USER_ID'], ['missing', 404, 'USER_NOT_FOUND'],
    ['off', 403, 'USER_DISABLED'], ['bad-role', 422, 'UNKNOWN_USER_ROLE']]) {
    await expectError(await h.request('/api/v2/orders/' + order.id, id), status, code)
    await expectError(await h.request('/api/orders/' + order.id + '/payment', id, payment('PAYMENT_APPROVED')), status, code)
  }
  assert.equal(findById.mock.callCount() + findForOwner.mock.callCount(), 0)
  assert.equal(h.sandbox.mock.callCount(), 0)
})

test('la identidad se resuelve una sola vez por request y el body no puede fijar el propietario', { timeout: 10000 }, async t => {
  const h = await environment(t)
  const order = await h.create('buyer', 'single-resolve')
  h.resolve.mock.resetCalls()
  assert.equal((await h.request('/api/v2/orders/' + order.id, 'buyer')).status, 200)
  assert.equal(h.resolve.mock.callCount(), 1)
  const forged = await h.request('/api/orders/' + order.id + '/payment', 'other', { ...payment('PAYMENT_APPROVED'), userId: 'buyer', ownerId: 'buyer', role: 'B2C' })
  await expectError(forged, 404, 'ORDER_NOT_FOUND')
  assert.equal(h.sandbox.mock.callCount(), 0)
})

test('Orders históricas sin propietario: compradores no acceden, ADMIN consulta y nadie paga', { timeout: 10000 }, async t => {
  const h = await environment(t)
  const template = await h.create('buyer', 'legacy-template')
  const legacy = { ...template, id: 'legacy-order', orderNumber: 'CN-LEGACY' }
  delete legacy.commercial
  delete legacy.contractVersion
  await h.store.create(legacy, 'legacy-key')
  for (const id of ['buyer', 'other', 'business']) {
    await expectError(await h.request('/api/v2/orders/legacy-order', id), 404, 'ORDER_NOT_FOUND')
    await expectError(await h.request('/api/orders/legacy-order', id), 404, 'ORDER_NOT_FOUND')
    await expectError(await h.request('/api/orders/legacy-order/payment', id, payment('PAYMENT_APPROVED')), 404, 'ORDER_NOT_FOUND')
  }
  const adminRead = await h.request('/api/v2/orders/legacy-order', 'admin')
  assert.equal(adminRead.status, 200)
  assert.deepEqual(await adminRead.json(), legacy)
  await expectError(await h.request('/api/orders/legacy-order/payment', 'admin', payment('PAYMENT_APPROVED')), 403, 'FORBIDDEN')
  assert.equal(await h.store.findByIdForOwner('legacy-order', 'buyer'), undefined, 'No se asigna al usuario activo')
  assert.ok(await h.store.findById('legacy-order'), 'No se elimina la Order histórica')
  assert.equal(h.sandbox.mock.callCount(), 0)
})
