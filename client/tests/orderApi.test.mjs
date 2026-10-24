/** Verifica serialización, validación y errores del cliente HTTP de Orders con respuestas simuladas. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

// Ejecuta el service real sin levantar React ni agregar dependencias de tests.
const source = readFileSync(new URL('../src/services/orderApi.ts', import.meta.url), 'utf8').replace('import.meta.env.VITE_API_BASE_URL', 'undefined')
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ESNext } }).outputText
const { orderApi, OrderApiError, orderErrorMessage } = await import('data:text/javascript;base64,' + Buffer.from(compiled).toString('base64'))
const request = {
  buyer: { fullName: 'Prueba', email: 'prueba@example.com', phone: '88888888' },
  delivery: { province: 'San José', canton: 'San José', address: 'Dirección ficticia' },
  items: [{ productId: 'product-1', quantity: 2, unitPrice: 1, lineSubtotal: 2 }],
  termsAcceptance: { accepted: true, version: '2026-10-lab4-v1', acceptedAt: 'forged' },
  idempotencyKey: 'same-attempt', totals: { total: 1 },
}
const order = {
  id: 'server-id', orderNumber: 'CN-2026-001', createdAt: '2026-10-12T12:00:00Z',
  buyer: request.buyer, delivery: request.delivery,
  items: [{ productId: 'product-1', name: 'Producto', image: '', unitPrice: 5000, quantity: 2, lineSubtotal: 10000 }],
  totals: { subtotal: 10000, tax: 1300, shipping: 3500, total: 14800 },
  currency: 'CRC', orderStatus: 'PENDING', paymentStatus: 'PENDING',
}

test('serializa referencias sin importes y conserva el snapshot del servidor', async () => {
  const original = globalThis.fetch
  const sent = []
  globalThis.fetch = async (url, options) => {
    assert.equal(url, '/api/orders')
    assert.equal(options.method, 'POST')
    sent.push(JSON.parse(options.body))
    return Response.json(order, {status:201})
  }
  try {
    assert.deepEqual(await orderApi.createOrder(request), order)
    await orderApi.createOrder(request)
    assert.deepEqual(sent[0], { buyer: request.buyer, delivery: request.delivery, items: [{ productId: 'product-1', quantity: 2 }], idempotencyKey: 'same-attempt', termsAcceptance: { accepted: true, version: request.termsAcceptance.version } })
    assert.equal(sent[1].idempotencyKey, sent[0].idempotencyKey)
  } finally { globalThis.fetch = original }
})

test('errores controlados permiten corregir sin mostrar mensajes internos', async () => {
  const original = globalThis.fetch
  try {
    for (const [status, code] of [[400, 'CHECKOUT_VALIDATION_ERROR'], [400, 'EMPTY_CART'], [404, 'PRODUCT_NOT_FOUND']]) {
      globalThis.fetch = async () => Response.json({error:{code,message:'SECRET_INTERNAL'}}, {status})
      await assert.rejects(orderApi.createOrder(request), error => {
        assert.ok(error instanceof OrderApiError)
        assert.equal(error.conclusive, true)
        assert.equal(error.code, code)
        assert.ok(!orderErrorMessage(error).includes('SECRET_INTERNAL'))
        return true
      })
    }
  } finally { globalThis.fetch = original }
})

test('fallo técnico o respuesta 201 inválida mantienen el intento pendiente', async () => {
  const original = globalThis.fetch
  try {
    for (const response of [Response.json({error:{code:'UNEXPECTED_ERROR'}}, {status:500}), Response.json({}, {status:201}), Response.json({...order, orderStatus:'PENDING', paymentStatus:'APPROVED'}, {status:201}), new Response('invalid-json', {status:201})]) {
      globalThis.fetch = async () => response
      await assert.rejects(orderApi.createOrder(request), error => error instanceof OrderApiError && !error.conclusive)
    }
    globalThis.fetch = async () => { throw new TypeError('Network failure') }
    await assert.rejects(orderApi.createOrder(request), error => orderErrorMessage(error).includes('Intentalo nuevamente'))
  } finally { globalThis.fetch = original }
})

test('replay acepta únicamente las cuatro combinaciones coherentes', async () => {
  const original = globalThis.fetch
  try {
    for (const orderStatus of ['PENDING', 'CONFIRMED', 'UNKNOWN', undefined]) {
      for (const paymentStatus of ['PENDING', 'DECLINED', 'ERROR', 'APPROVED', 'UNKNOWN', undefined]) {
        const snapshot = {...order, orderStatus, paymentStatus}
        globalThis.fetch = async () => Response.json(snapshot, {status:201})
        const valid = (orderStatus === 'PENDING' && ['PENDING','DECLINED','ERROR'].includes(paymentStatus))
          || (orderStatus === 'CONFIRMED' && paymentStatus === 'APPROVED')
        if (valid) assert.deepEqual(await orderApi.createOrder(request), snapshot)
        else await assert.rejects(orderApi.createOrder(request), error => error instanceof OrderApiError && !error.conclusive)
      }
    }
  } finally { globalThis.fetch = original }
})

test('un replay aprobado conserva toda la validación estructural', async () => {
  const original = globalThis.fetch
  const approved = {...order, orderStatus:'CONFIRMED', paymentStatus:'APPROVED'}
  try {
    for (const patch of [
      {id:''}, {orderNumber:''}, {createdAt:'invalid'}, {buyer:null}, {delivery:{...order.delivery,address:''}},
      {currency:'USD'}, {totals:{...order.totals,total:-1}}, {items:[]},
      {items:[{...order.items[0],quantity:0}]}, {items:[{...order.items[0],unitPrice:'5000'}]},
    ]) {
      globalThis.fetch = async () => Response.json({...approved,...patch}, {status:201})
      await assert.rejects(orderApi.createOrder(request), error => error instanceof OrderApiError && !error.conclusive)
    }
  } finally { globalThis.fetch = original }
})

test('CN-46 serialización conserva accepted false y no inventa consentimiento', async t => {
  t.mock.method(globalThis, 'fetch', async (_, options) => {
    const payload = JSON.parse(options.body)
    assert.deepEqual(payload.termsAcceptance, {accepted:false, version:request.termsAcceptance.version})
    assert.equal('acceptedAt' in payload.termsAcceptance,false)
    return Response.json(order,{status:201})
  })
  assert.deepEqual(await orderApi.createOrder({...request,termsAcceptance:{...request.termsAcceptance,accepted:false}}),order)
})
