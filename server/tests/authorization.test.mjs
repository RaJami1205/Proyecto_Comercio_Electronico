/** RBAC HTTP con UserService real, directorio ficticio y stores por prueba; todo el tráfico usa loopback. */
import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { serverConfig } from '../dist/config/env.js'
import { orderService } from '../dist/services/orderService.js'
import { paymentService } from '../dist/services/paymentService.js'
import { userService } from '../dist/services/userService.js'
import { InMemoryOrderStore } from '../dist/stores/orderStore.js'
import { mockUserDirectory } from './helpers/identity.mjs'

const allowedOrigin = 'https://rajami1205.github.io'
serverConfig.clientOrigin = allowedOrigin
const { default: app } = await import('../dist/app.js')
const input = key => ({ buyer: { fullName: 'Prueba', email: 'test@example.com', phone: '88888888' },
  delivery: { province: 'San José', canton: 'Central', address: 'Ficticia' },
  items: [{ productId: 'p', quantity: 1 }], idempotencyKey: key,
  termsAcceptance: { accepted: true, version: '2026-10-lab4-v1' } })
const payment = (scenario = 'PAYMENT_APPROVED', key = scenario) => ({ scenario, idempotencyKey: key })

/** Sustituye solo las fuentes externas y renueva el almacenamiento compartido por ambos servicios. */
async function environment(t) {
  const records = ['a', 'b', 'off', 'admin', 'business', 'bad-role'].map(id => ({ objectID: id, displayName: id,
    enabled: id !== 'off', role: id === 'admin' ? 'ADMIN' : id === 'business' ? 'B2B' : id === 'bad-role' ? 'GUEST' : 'B2C',
    ...(id === 'business' ? { company: { id: 'co', name: 'Empresa ficticia' } } : {}) }))
  mockUserDirectory(t, records)
  const originalOrderStore = orderService.store, originalPaymentStore = paymentService.store
  const store = new InMemoryOrderStore()
  orderService.store = store
  paymentService.store = store
  t.after(() => { orderService.store = originalOrderStore; paymentService.store = originalPaymentStore })
  const lookup = t.mock.method(orderService, 'lookup', async id => ({ objectID: id, title: 'Producto', price: 10000, in_stock: true, stock_quantity: 10 }))
  const sandbox = t.mock.method(paymentService.sandbox, 'process', async request => ({ result: request.scenario }))
  const resolve = t.mock.method(userService, 'resolve')
  const server = app.listen(0, '127.0.0.1')
  await new Promise(resolve => server.once('listening', resolve))
  t.after(() => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())))
  const base = 'http://127.0.0.1:' + server.address().port
  const request = (path, id = 'a', body, extraHeaders = {}) => fetch(base + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { ...(id === null ? {} : { 'X-CiberNova-User-Id': id }),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...extraHeaders },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  return { records, store, lookup, sandbox, resolve, server, base, request }
}

async function error(response, status, code) {
  assert.equal(response.status, status)
  const body = await response.json()
  assert.equal(body.error.code, code)
  assert.equal(body.error.stack, undefined)
  return body
}

test('todas las operaciones rechazan identidad/rol inválidos antes de efectos comerciales', async t => {
  const h = await environment(t)
  const cases = [[null, 401, 'IDENTITY_REQUIRED'], ['', 400, 'INVALID_USER_ID'], ['a,b', 400, 'INVALID_USER_ID'],
    ['a'.repeat(65), 400, 'INVALID_USER_ID'], ['missing', 404, 'USER_NOT_FOUND'], ['off', 403, 'USER_DISABLED'],
    ['business', 403, 'FORBIDDEN'], ['admin', 403, 'FORBIDDEN'], ['bad-role', 422, 'UNKNOWN_USER_ROLE']]
  for (const [id, status, code] of cases) {
    for (const [path, body] of [['/api/orders', input('denied')], ['/api/orders/unknown', undefined], ['/api/orders/unknown/payment', payment()]]) {
      await error(await h.request(path, id, body), status, code)
    }
  }
  assert.equal(h.lookup.mock.calls.length, 0)
  assert.equal(h.sandbox.mock.calls.length, 0)
  assert.equal((await h.store.findByIdempotencyKey('denied')), undefined)
})

test('rechaza headers duplicados incluso con el mismo valor y distinto casing', async t => {
  const h = await environment(t)
  for (const second of ['a', 'b']) {
    const response = await new Promise((resolve, reject) => {
      const request = http.request(h.base + '/api/orders', { method: 'POST', headers: [
        'Host', new URL(h.base).host,
        'Content-Length', String(Buffer.byteLength(JSON.stringify(input('duplicate')))),
        'X-CiberNova-User-Id', 'a', 'x-cibernova-user-id', second, 'Content-Type', 'application/json',
      ] }, response => {
        let body = ''
        response.on('data', chunk => { body += chunk })
        response.on('end', () => resolve({ status: response.statusCode, body: JSON.parse(body) }))
      })
      request.on('error', reject)
      request.end(JSON.stringify(input('duplicate')))
    })
    assert.equal(response.status, 400)
    assert.equal(response.body.error.code, 'INVALID_USER_ID')
  }
  assert.equal(h.resolve.mock.calls.length, 0)
  assert.equal(h.lookup.mock.calls.length, 0)
})

test('el owner procede del header validado y se revalida una vez por cada operación', async t => {
  const h = await environment(t)
  assert.equal((await h.request('/api/session/resolve', null, { userId: 'a' })).status, 200)
  h.resolve.mock.resetCalls()
  const response = await h.request('/api/orders', 'a', { ...input('owner'), userId: 'b', ownerId: 'b', role: 'ADMIN', enabled: true, company: { id: 'forged' } })
  assert.equal(response.status, 201)
  const order = await response.json()
  assert.equal(h.resolve.mock.calls.length, 1)
  assert.equal('userId' in order, false)
  assert.equal('ownerId' in order, false)
  assert.deepEqual(await (await h.request('/api/orders/' + order.id)).json(), order)
  await error(await h.request('/api/orders/' + order.id, 'b'), 404, 'ORDER_NOT_FOUND')
  await error(await h.request('/api/orders', 'b', input('owner')), 404, 'ORDER_NOT_FOUND')
  h.records.find(record => record.objectID === 'a').enabled = false
  await error(await h.request('/api/orders/' + order.id), 403, 'USER_DISABLED')
  await error(await h.request('/api/orders/' + order.id + '/payment', 'a', payment()), 403, 'USER_DISABLED')
  h.records.find(record => record.objectID === 'a').enabled = true
  h.records.find(record => record.objectID === 'a').role = 'ADMIN'
  await error(await h.request('/api/orders/' + order.id), 403, 'FORBIDDEN')
  assert.equal(h.sandbox.mock.calls.length, 0)
})

test('un fallo del directorio conserva 503 y los endpoints de identidad permanecen públicos', async t => {
  const h = await environment(t)
  assert.equal((await h.request('/api/users', null)).status, 200)
  for (const userId of ['a', 'admin', 'business']) {
    assert.equal((await h.request('/api/session/resolve', null, { userId, role: 'ADMIN' })).status, 200)
  }
  t.mock.method(userService.directory, 'find', async () => { throw new Error('PRIVATE_DETAIL') })
  t.mock.method(console, 'error', () => {})
  const body = await error(await h.request('/api/orders', 'a', input('unavailable')), 503, 'USER_SERVICE_UNAVAILABLE')
  assert.equal(JSON.stringify(body).includes('PRIVATE_DETAIL'), false)
  assert.equal(h.lookup.mock.calls.length, 0)
})

test('concurrencia comparte solo owner/key compatibles y libera la key tras un fallo', async t => {
  const h = await environment(t)
  let release, started
  const gate = new Promise(resolve => { release = resolve })
  const entered = new Promise(resolve => { started = resolve })
  h.lookup.mock.mockImplementation(async id => { started(); await gate; return { objectID: id, title: 'Producto', price: 10000, in_stock: true, stock_quantity: 10 } })
  const first = h.request('/api/orders', 'a', input('parallel'))
  await entered
  const same = h.request('/api/orders', 'a', input('parallel'))
  try {
    await error(await h.request('/api/orders', 'b', input('parallel')), 404, 'ORDER_NOT_FOUND')
    await error(await h.request('/api/orders', 'a', { ...input('parallel'), items: [{ productId: 'p', quantity: 2 }] }), 409, 'CHECKOUT_VALIDATION_ERROR')
  } finally { release() }
  const order = await (await first).json()
  assert.deepEqual(await (await same).json(), order)
  assert.equal(h.lookup.mock.calls.length, 1)
  assert.deepEqual(await (await h.request('/api/orders', 'a', input('parallel'))).json(), order)
  h.lookup.mock.mockImplementation(async () => { throw new Error('Controlled failure') })
  await error(await h.request('/api/orders', 'a', input('failed')), 500, 'UNEXPECTED_ERROR')
  assert.equal((await h.store.findByIdempotencyKey('failed')), undefined)
  h.lookup.mock.mockImplementation(async id => ({ objectID: id, title: 'Producto', price: 10000, in_stock: true, stock_quantity: 10 }))
  const recovered = await h.request('/api/orders', 'b', input('failed'))
  assert.equal(recovered.status, 201)
  const ownedByB = await recovered.json()
  await error(await h.request('/api/orders/' + ownedByB.id, 'a'), 404, 'ORDER_NOT_FOUND')
  assert.equal((await h.request('/api/orders/' + ownedByB.id, 'b')).status, 200)
})

test('Payment y Replay comprueban owner antes del Sandbox y de devolver resultados históricos', async t => {
  const h = await environment(t)
  const order = await (await h.request('/api/orders', 'a', input('payments'))).json()
  const path = '/api/orders/' + order.id + '/payment'
  await error(await h.request(path, 'b', payment()), 404, 'ORDER_NOT_FOUND')
  assert.equal(h.sandbox.mock.calls.length, 0)
  let declined
  for (const scenario of ['PAYMENT_DECLINED', 'PAYMENT_ERROR', 'PAYMENT_APPROVED']) {
    const response = await h.request(path, 'a', payment(scenario))
    assert.equal(response.status, 200)
    const result = await response.json()
    if (scenario === 'PAYMENT_DECLINED') declined = result
    assert.deepEqual(await (await h.request(path, 'a', payment(scenario))).json(), result)
    await error(await h.request(path, 'b', payment(scenario)), 404, 'ORDER_NOT_FOUND')
  }
  assert.deepEqual(await (await h.request(path, 'a', payment('PAYMENT_DECLINED'))).json(), declined)
  await error(await h.request(path, 'a', payment('PAYMENT_APPROVED', 'new-key')), 409, 'ORDER_ALREADY_CONFIRMED')
  assert.equal(h.sandbox.mock.calls.length, 3)
  assert.equal((await (await h.request('/api/orders/' + order.id)).json()).orderStatus, 'CONFIRMED')
  const legacy = { ...order, id: 'legacy' }
  await h.store.create(legacy, 'legacy-key')
  await error(await h.request('/api/orders/legacy'), 404, 'ORDER_NOT_FOUND')
  await error(await h.request('/api/orders/legacy/payment', 'a', payment()), 404, 'ORDER_NOT_FOUND')
  await error(await h.request('/api/orders', 'a', input('legacy-key')), 404, 'ORDER_NOT_FOUND')
  assert.equal((await h.store.findByIdForOwner('legacy', 'a')), undefined)
  assert.equal(h.sandbox.mock.calls.length, 3)
  await assert.rejects(async () => (await h.store.create(order, 'payments', 'b')), { code: 'ORDER_NOT_FOUND' })
})

test('OPTIONS admite el header de identidad solo para el origen configurado y precede a RBAC', async t => {
  const h = await environment(t)
  for (const origin of [allowedOrigin, 'https://other.example']) {
    const response = await fetch(h.base + '/api/orders', { method: 'OPTIONS', headers: {
      Origin: origin, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type,x-cibernova-user-id',
    } })
    assert.equal(response.status, 204)
    assert.equal(response.headers.get('access-control-allow-origin'), allowedOrigin)
    assert.equal(response.headers.get('access-control-allow-origin') === origin, origin === allowedOrigin)
    assert.match(response.headers.get('access-control-allow-headers'), /x-cibernova-user-id/i)
    assert.match(response.headers.get('access-control-allow-methods'), /POST/)
    assert.equal(response.headers.get('access-control-allow-credentials'), null)
  }
  const denial = await h.request('/api/orders', null, input('cors'), { Origin: allowedOrigin })
  assert.equal(denial.headers.get('access-control-allow-origin'), allowedOrigin)
  await error(denial, 401, 'IDENTITY_REQUIRED')
  assert.equal(h.resolve.mock.calls.length, 0)
})
