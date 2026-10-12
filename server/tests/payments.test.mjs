import test from 'node:test'
import assert from 'node:assert/strict'
import app from '../dist/app.js'
import { OrderService, orderService } from '../dist/services/orderService.js'
import { PaymentService, paymentService } from '../dist/services/paymentService.js'
import { PaymentSandboxService } from '../dist/services/paymentSandboxService.js'
import { InMemoryOrderStore } from '../dist/stores/orderStore.js'

const fixture = (id = 'order-1') => ({
  id, orderNumber: 'CN-2026-' + id, createdAt: '2026-10-12T12:00:00Z',
  buyer: { fullName: 'Usuario Prueba', email: 'prueba@example.com', phone: '88888888' },
  delivery: { province: 'San José', canton: 'San José', address: 'Dirección ficticia' },
  items: [{ productId: 'product-1', name: 'Producto real', image: '', unitPrice: 10000, quantity: 2, lineSubtotal: 20000 }],
  totals: { subtotal: 20000, tax: 2600, shipping: 3500, total: 26100 },
  currency: 'CRC', orderStatus: 'PENDING', paymentStatus: 'PENDING',
})
const request = (scenario = 'PAYMENT_APPROVED', idempotencyKey = 'attempt-1') => ({scenario, idempotencyKey})
const setup = (sandbox = new PaymentSandboxService()) => {
  const store = new InMemoryOrderStore()
  store.create(fixture(), 'creation-1')
  return { store, service: new PaymentService(store, sandbox) }
}

for (const [scenario, paymentStatus, orderStatus] of [
  ['PAYMENT_APPROVED', 'APPROVED', 'CONFIRMED'],
  ['PAYMENT_DECLINED', 'DECLINED', 'PENDING'],
  ['PAYMENT_ERROR', 'ERROR', 'PENDING'],
]) {
  test('Sandbox determinista y transición: ' + scenario, async () => {
    const {store, service} = setup()
    const result = await service.process('order-1', request(scenario))
    assert.equal(result.result, scenario)
    assert.equal(result.order.paymentStatus, paymentStatus)
    assert.equal(result.order.orderStatus, orderStatus)
    assert.ok(Number.isFinite(Date.parse(result.processedAt)))
    assert.deepEqual(store.findById('order-1'), result.order)
    assert.deepEqual(result.order.totals, fixture().totals)
    assert.deepEqual(result.order.items, fixture().items)
  })
}

test('amount, currency e identidad proceden del store; replay aprobado y nuevo pago bloqueado', async () => {
  const calls = []
  const {store, service} = setup({ process: async input => { calls.push(input); return {result: input.scenario} } })
  const payment = await service.process('order-1', { ...request(), amount: 1, currency: 'USD', orderId: 'attacker', orderStatus: 'PENDING', paymentStatus: 'ERROR' })
  assert.deepEqual(calls, [{orderId:'order-1', amount:26100, currency:'CRC', scenario:'PAYMENT_APPROVED'}])
  const replay = await service.process('order-1', request('PAYMENT_DECLINED'))
  assert.deepEqual(replay, payment)
  assert.equal(calls.length, 1)
  replay.order.totals.total = 1
  assert.equal((await service.process('order-1', request())).order.totals.total, 26100)
  assert.equal(store.findById('order-1').totals.total, 26100)
  await assert.rejects(service.process('order-1', request('PAYMENT_APPROVED', 'new-key')), error => error.status === 409 && error.code === 'ORDER_ALREADY_CONFIRMED')
  assert.equal(calls.length, 1)
})

for (const scenario of ['PAYMENT_DECLINED', 'PAYMENT_ERROR']) {
  test('Retry sobre la misma Order y replay histórico después de ' + scenario, async () => {
    let calls = 0
    const {store, service} = setup({process: async input => { calls++; return {result: input.scenario} }})
    const first = await service.process('order-1', request(scenario))
    assert.deepEqual(await service.process('order-1', request(scenario)), first)
    const approved = await service.process('order-1', request('PAYMENT_APPROVED', 'retry-key'))
    assert.equal(approved.order.id, first.order.id)
    assert.equal(approved.order.paymentStatus, 'APPROVED')
    assert.equal(store.findById('order-1').orderStatus, 'CONFIRMED')
    assert.deepEqual(await service.process('order-1', request(scenario)), first)
    assert.equal(calls, 2)
  })
}

test('dos solicitudes concurrentes: misma o distinta clave solo inicia un Sandbox', async () => {
  for (const secondKey of ['attempt-1', 'attempt-2']) {
    let release
    let calls = 0
    const completion = new Promise(resolve => { release = resolve })
    const {store, service} = setup({process: async input => { calls++; await completion; return {result:input.scenario} }})
    const first = service.process('order-1', request('PAYMENT_DECLINED'))
    await assert.rejects(service.process('order-1', request('PAYMENT_APPROVED', secondKey)), error => error.status === 409 && error.code === 'PAYMENT_IN_PROGRESS')
    assert.equal(calls, 1)
    assert.equal(store.findById('order-1').paymentStatus, 'PENDING')
    release()
    const result = await first
    assert.equal(result.order.paymentStatus, 'DECLINED')
    assert.deepEqual(await service.process('order-1', request('PAYMENT_DECLINED')), result)
    assert.equal(calls, 1)
    assert.equal((await service.process('order-1', request('PAYMENT_APPROVED', 'retry'))).order.orderStatus, 'CONFIRMED')
  }
})

test('locks y claves de idempotencia se aíslan por orden', async () => {
  let release
  const completion = new Promise(resolve => { release = resolve })
  const {store, service} = setup({process: async input => { await completion; return {result:input.scenario} }})
  store.create(fixture('order-2'), 'creation-2')
  const first = service.process('order-1', request('PAYMENT_DECLINED'))
  const second = service.process('order-2', request('PAYMENT_APPROVED'))
  release()
  const results = await Promise.all([first, second])
  assert.deepEqual(results.map(result => result.order.id), ['order-1', 'order-2'])
  assert.deepEqual(results.map(result => result.result), ['PAYMENT_DECLINED', 'PAYMENT_APPROVED'])
})

test('fallos reales liberan lock y no cachean resultados ni cambian la Order', async () => {
  let fail = true
  const {store, service} = setup({process: async input => {
    if (fail) throw new Error('SECRET_INTERNAL_DETAIL')
    return {result:input.scenario}
  }})
  await assert.rejects(service.process('order-1', request()))
  assert.deepEqual(store.findById('order-1'), fixture())
  fail = false
  assert.equal((await service.process('order-1', request())).order.paymentStatus, 'APPROVED')
  const broken = setup({process:async () => ({result:'UNSUPPORTED'})})
  await assert.rejects(broken.service.process('order-1', request()))
  assert.deepEqual(broken.store.findById('order-1'), fixture())
  const failedUpdate = setup({process:async input => ({result:input.scenario})})
  const update = failedUpdate.store.update.bind(failedUpdate.store)
  failedUpdate.store.update = () => { throw new Error('update failure') }
  await assert.rejects(failedUpdate.service.process('order-1', request()))
  failedUpdate.store.update = update
  assert.equal((await failedUpdate.service.process('order-1', request())).order.paymentStatus, 'APPROVED')
})

test('valida request y orden sin ejecutar el Sandbox; APPROVED siempre impide nuevo pago', async () => {
  const {store, service} = setup({process:async () => assert.fail('No debe procesar')})
  for (const body of [undefined, null, [], {}, request('INVALID'), request(1), request('PAYMENT_APPROVED', ''), request('PAYMENT_APPROVED', '   '), request('PAYMENT_APPROVED', 1)]) {
    await assert.rejects(service.process('order-1', body), error => error.status === 400)
  }
  await assert.rejects(service.process('missing', request()), error => error.status === 404 && error.code === 'ORDER_NOT_FOUND')
  store.update({...fixture(), paymentStatus:'APPROVED'})
  await assert.rejects(service.process('order-1', request()), error => error.code === 'ORDER_ALREADY_CONFIRMED')
})

test('HTTP: tres resultados 200, GET actualizado, replay, concurrencia y errores del contrato', async () => {
  const originalLookup = orderService.lookup
  const originalSandbox = paymentService.sandbox
  orderService.lookup = async id => ({objectID:id, title:'Producto', price:10000, image_url:''})
  const server = app.listen(0,'127.0.0.1')
  await new Promise(resolve => server.once('listening',resolve))
  const base = 'http://127.0.0.1:' + server.address().port + '/api/orders'
  const post = (url, body) => fetch(url, {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body)})
  const create = async key => {
    const response = await post(base, {buyer:fixture().buyer, delivery:fixture().delivery, items:[{productId:'product-1',quantity:2}], idempotencyKey:key})
    assert.equal(response.status,201)
    return response.json()
  }
  try {
    for (const scenario of ['PAYMENT_APPROVED','PAYMENT_DECLINED','PAYMENT_ERROR']) {
      const order = await create('http-' + scenario)
      const url = base + '/' + order.id + '/payment'
      const response = await post(url, {...request(scenario), amount:1, currency:'USD'})
      assert.equal(response.status,200)
      const result = await response.json()
      assert.equal(result.result,scenario)
      assert.deepEqual(result.order.totals,order.totals)
      assert.deepEqual(await (await fetch(base + '/' + order.id)).json(),result.order)
      assert.deepEqual(await (await post(url,request(scenario))).json(),result)
      if (scenario === 'PAYMENT_APPROVED') {
        const blocked = await post(url,request(scenario,'new-key'))
        assert.equal(blocked.status,409)
        assert.equal((await blocked.json()).error.code,'ORDER_ALREADY_CONFIRMED')
      } else {
        const retry = await post(url,request('PAYMENT_APPROVED','retry-key'))
        assert.equal(retry.status,200)
        assert.equal((await retry.json()).order.orderStatus,'CONFIRMED')
      }
    }
    const order = await create('http-invalid')
    const url = base + '/' + order.id + '/payment'
    for (const [response,status,code] of [
      [await post(base + '/missing/payment',request()),404,'ORDER_NOT_FOUND'],
      [await post(url,request('INVALID')),400,'INVALID_PAYMENT_SCENARIO'],
      [await post(url,request('PAYMENT_APPROVED','')),400,'CHECKOUT_VALIDATION_ERROR'],
      [await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:'{'}),400,'CHECKOUT_VALIDATION_ERROR'],
      [await fetch(url,{method:'POST'}),400,'CHECKOUT_VALIDATION_ERROR'],
    ]) {
      assert.equal(response.status,status)
      const body = await response.json()
      assert.equal(body.error.code,code)
      assert.equal(body.error.stack,undefined)
    }
    paymentService.sandbox = {process:async () => {throw new Error('SECRET_INTERNAL_DETAIL')}}
    const failure = await post(url,request())
    assert.equal(failure.status,500)
    const error = await failure.json()
    assert.equal(error.error.code,'UNEXPECTED_ERROR')
    assert.ok(!JSON.stringify(error).includes('SECRET_INTERNAL_DETAIL'))
    let started, release
    const began = new Promise(resolve => {started = resolve})
    const completion = new Promise(resolve => {release = resolve})
    let calls = 0
    paymentService.sandbox = {process:async input => {calls++; started(); await completion; return {result:input.scenario}}}
    const first = post(url,request('PAYMENT_DECLINED'))
    await began
    try {
      const blocked = await post(url,request('PAYMENT_APPROVED','concurrent'))
      assert.equal(blocked.status,409)
      assert.equal((await blocked.json()).error.code,'PAYMENT_IN_PROGRESS')
      assert.equal(calls,1)
    } finally {release()}
    assert.equal((await first).status,200)
  } finally {
    orderService.lookup = originalLookup
    paymentService.sandbox = originalSandbox
    await new Promise((resolve,reject) => server.close(error => error ? reject(error) : resolve()))
  }
})
