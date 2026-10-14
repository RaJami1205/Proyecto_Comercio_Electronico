import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

const dataUrl = source => 'data:text/javascript;base64,' + Buffer.from(source).toString('base64')
// Harness de handlers/estado; no sustituye las verificaciones DOM, foco o responsive.
const runtimeUrl = dataUrl(`
  let slots = [], cursor = 0;
  export let cart = []; export let cleanupCount = 0;
  export function reset(items) { slots = []; cursor = 0; cart = items; cleanupCount = 0; }
  export function renderStart() { cursor = 0; }
  export function useState(initial) {
    const index = cursor++;
    if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial;
    return [slots[index], value => { slots[index] = typeof value === 'function' ? value(slots[index]) : value; }];
  }
  export function useRef(initial) { const [value] = useState(() => ({current:initial})); return value; }
  export function useEffect() {}
  export function useCart() { return {items:cart, clearCart: () => { cleanupCount++; }}; }
  export const Fragment = 'Fragment';
  export function jsx(type, props) { return {type, props}; }
  export const jsxs = jsx;
`)
const runtime = await import(runtimeUrl)
const modules = new Map([
  ['react', runtimeUrl], ['react/jsx-runtime', runtimeUrl],
  ['../hooks/useCart', runtimeUrl],
])
for (const name of ['CheckoutStepper', 'BuyerStep', 'DeliveryStep', 'ReviewStep', 'PaymentStep', 'PaymentResultPanel']) {
  modules.set('../components/checkout/' + name, dataUrl(`export default ${JSON.stringify(name)}`))
}
for (const name of ['Header', 'Footer']) modules.set('../components/layout/' + name, dataUrl(`export default ${JSON.stringify(name)}`))
function compile(file) {
  const source = readFileSync(new URL('../src/' + file, import.meta.url), 'utf8').replace('import.meta.env.VITE_API_BASE_URL', 'undefined')
  const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX } }).outputText
  return dataUrl(js.replace(/from ['"]([^'"]+)['"]/g, (_, dependency) => {
    const target = dependency.endsWith('.css') ? dataUrl('export default {}') : modules.get(dependency)
    assert.ok(target, 'Dependencia sin aislar: ' + dependency)
    return 'from ' + JSON.stringify(target)
  }))
}
const calculationsUrl = compile('utils/cartCalculations.ts')
modules.set('./cartCalculations', calculationsUrl)
modules.set('../utils/cartCalculations', calculationsUrl)
modules.set('../utils/checkoutValidation', compile('utils/checkoutValidation.ts'))
const differencesUrl = compile('utils/orderReviewDifferences.ts')
modules.set('../utils/orderReviewDifferences', differencesUrl)
const apiUrl = compile('services/orderApi.ts')
modules.set('../services/orderApi', apiUrl)
const paymentApiUrl = compile('services/paymentApi.ts');
modules.set('../services/paymentApi', paymentApiUrl);
const { paymentApi, PaymentApiError } = await import(paymentApiUrl);
const { default: CheckoutPage } = await import(compile('pages/CheckoutPage.tsx'))
const { calculateCartTotals } = await import(calculationsUrl)
const buyer = { fullName: 'Prueba', email: 'test@example.com', phone: '88888888' }
const delivery = { province: 'San José', canton: 'Central', address: 'Dirección' }
const cart = [{ productId: 'p', name: 'Producto', image: '', price: 10000, quantity: 1 }]
function order() {
  return { id:'order-1', orderNumber:'CN-1', createdAt:'2026-10-12T00:00:00Z', buyer, delivery,
    items:[{productId:'p', name:'Producto', image:'', unitPrice:10000, quantity:1, lineSubtotal:10000}],
    totals:calculateCartTotals(cart), currency:'CRC', orderStatus:'PENDING', paymentStatus:'PENDING' }
}
function nodes(tree) {
  if (Array.isArray(tree)) return tree.flatMap(nodes)
  if (!tree || typeof tree !== 'object') return []
  return [tree, ...nodes(tree.props?.children)]
}
function checkout() {
  runtime.reset(structuredClone(cart))
  const events = []
  const props = { onBackToCart: () => events.push('exit'), onCatalogClick: () => {}, onCartClick: () => {},
    onNavigationLockChange: busy => events.push(busy), onOrderCreated: () => events.push('created') }
  let tree
  const render = () => { runtime.renderStart(); tree = CheckoutPage(props) }
  const find = type => nodes(tree).find(node => node.type === type)?.props
  render()
  find('BuyerStep').onContinue(buyer)
  render()
  find('DeliveryStep').onContinue(delivery)
  render()
  return { render, find, review: () => find('ReviewStep'), step: () => find('CheckoutStepper').currentStep, events }
}

// Pruebas dirigidas F1/F2/F4. No reparan la suite histórica pendiente de F7.
const result = (scenario, changes = {}) => ({
  result: scenario, processedAt: order().createdAt,
  order: {...order(), orderStatus: scenario === 'PAYMENT_APPROVED' ? 'CONFIRMED' : 'PENDING',
    paymentStatus: scenario.replace('PAYMENT_', '')}, ...changes,
})
async function paymentFlow(t, scenario = 'PAYMENT_DECLINED') {
  const original = globalThis.fetch
  t.after(() => { globalThis.fetch = original })
  const requests = []
  let respond = request => Response.json(result(request.scenario))
  globalThis.fetch = async (url, options) => {
    assert.equal(options.method, 'POST')
    const payload = JSON.parse(options.body)
    requests.push({url, payload})
    if (url === '/api/orders') return Response.json(order(), {status:201})
    assert.equal(url, '/api/orders/order-1/payment')
    assert.deepEqual(Object.keys(payload).sort(), ['idempotencyKey', 'scenario'])
    return respond(payload)
  }
  const flow = checkout()
  await flow.review().onConfirm(); flow.render()
  flow.find('PaymentStep').onScenarioChange(scenario); flow.render()
  return {...flow, requests, respond: fn => { respond = fn }, payment: () => flow.find('PaymentStep')}
}

test('F1 dos llamadas inmediatas emiten un POST y mantienen navegación bloqueada', async t => {
  const flow = await paymentFlow(t)
  let resolve
  flow.respond(() => new Promise(done => { resolve = done }))
  const handler = flow.payment().onProcessPayment
  const first = handler()
  await handler()
  assert.equal(flow.requests.length, 2) // una creación, un pago
  assert.equal(flow.events.at(-1), true)
  flow.render()
  assert.equal(flow.payment().isProcessingPayment, true)
  flow.payment().onScenarioChange('PAYMENT_APPROVED')
  flow.render()
  assert.equal(flow.payment().selectedScenario, 'PAYMENT_DECLINED')
  resolve(Response.json(result('PAYMENT_DECLINED')))
  await first
  assert.equal(flow.events.at(-1), false)
  await handler() // callback anterior tampoco inicia otro intento completado
  assert.equal(flow.requests.length, 2)
})

test('F2 fallo de red conserva Order, escenario y key incluso ante callback de selección', async t => {
  const flow = await paymentFlow(t)
  const snapshot = flow.payment().order
  flow.respond(() => { throw new TypeError('Fallo simulado') })
  await flow.payment().onProcessPayment(); flow.render()
  assert.equal(flow.payment().order, snapshot)
  assert.equal(flow.payment().scenarioLocked, true)
  flow.payment().onScenarioChange('PAYMENT_APPROVED'); flow.render()
  assert.equal(flow.payment().selectedScenario, 'PAYMENT_DECLINED')
  flow.respond(request => Response.json(result(request.scenario)))
  await flow.payment().onProcessPayment(); flow.render()
  assert.deepEqual(flow.requests[1], flow.requests[2])
  assert.equal(flow.requests.filter(r => r.url === '/api/orders').length, 1)
})

for (const scenario of ['PAYMENT_DECLINED', 'PAYMENT_ERROR']) {
  test('F2 nuevo intento tras ' + scenario + ' usa nueva key en la misma Order', async t => {
    const flow = await paymentFlow(t, scenario)
    await flow.payment().onProcessPayment(); flow.render()
    flow.find('PaymentResultPanel').onRetry(); flow.render()
    assert.equal(flow.payment().selectedScenario, null)
    flow.payment().onScenarioChange(scenario); flow.render()
    await flow.payment().onProcessPayment(); flow.render()
    assert.notEqual(flow.requests[1].payload.idempotencyKey, flow.requests[2].payload.idempotencyKey)
    assert.equal(flow.requests[1].url, flow.requests[2].url)
    assert.equal(flow.requests.length, 3)
  })
}

test('F1 Approved bloquea más pagos, incluidos callbacks previos al render', async t => {
  const flow = await paymentFlow(t, 'PAYMENT_APPROVED')
  const handler = flow.payment().onProcessPayment
  await handler()
  await handler()
  flow.render()
  assert.equal(flow.find('PaymentResultPanel').onRetry, undefined)
  assert.equal(flow.find('PaymentResultPanel').order.orderStatus, 'CONFIRMED')
  assert.equal(flow.requests.length, 2)
})

const invalidResults = [
  ['Approved/Pending', () => result('PAYMENT_APPROVED', {order:order()})],
  ['Order ajena', () => result('PAYMENT_APPROVED', {order:{...result('PAYMENT_APPROVED').order, id:'other'}})],
  ['escenario ajeno', () => result('PAYMENT_DECLINED')],
  ['fecha ausente', () => result('PAYMENT_APPROVED', {processedAt:undefined})],
  ['fecha inválida', () => result('PAYMENT_APPROVED', {processedAt:'invalid'})],
  ['Order incompleta', () => result('PAYMENT_APPROVED', {order:{id:'order-1'}})],
]
for (const [name, invalid] of invalidResults) {
  test('F4 ' + name + ' no sustituye Order, no limpia Cart y conserva intento', async t => {
    const flow = await paymentFlow(t, 'PAYMENT_APPROVED')
    const snapshot = flow.payment().order
    flow.respond(() => Response.json(invalid()))
    await flow.payment().onProcessPayment(); flow.render()
    assert.equal(flow.payment().order, snapshot)
    assert.equal(flow.find('PaymentResultPanel'), undefined)
    assert.equal(runtime.cleanupCount, 0)
    assert.ok(flow.payment().error)
    assert.equal(flow.payment().scenarioLocked, true)
    flow.respond(() => Response.json(result('PAYMENT_APPROVED')))
    await flow.payment().onProcessPayment(); flow.render()
    assert.deepEqual(flow.requests[1], flow.requests[2])
    assert.equal(flow.find('PaymentResultPanel').order.orderStatus, 'CONFIRMED')
  })
}

test('F4 rechaza todas las combinaciones contradictorias en el límite API', async t => {
  const original = globalThis.fetch
  t.after(() => { globalThis.fetch = original })
  for (const scenario of ['PAYMENT_APPROVED', 'PAYMENT_DECLINED', 'PAYMENT_ERROR']) {
    for (const [orderStatus, paymentStatus] of [['PENDING','PENDING'], ['PENDING','DECLINED'], ['PENDING','ERROR'], ['CONFIRMED','APPROVED'], ['CONFIRMED','ERROR']]) {
      const body = result(scenario)
      const valid = body.order.orderStatus === orderStatus && body.order.paymentStatus === paymentStatus
      body.order.orderStatus = orderStatus; body.order.paymentStatus = paymentStatus
      globalThis.fetch = async () => Response.json(body)
      const call = paymentApi.processPayment('order-1', {scenario, idempotencyKey:'test'})
      if (valid) assert.deepEqual(await call, body)
      else await assert.rejects(call, error => error instanceof PaymentApiError && !error.conclusive)
    }
  }
})

test('API excluye campos de tarjeta demostrativos y otros extras del payload', async t => {
  const original = globalThis.fetch
  t.after(() => { globalThis.fetch = original })
  globalThis.fetch = async (url, options) => {
    assert.equal(url, '/api/orders/order-1/payment')
    assert.deepEqual(JSON.parse(options.body), {scenario:'PAYMENT_APPROVED', idempotencyKey:'test'})
    return Response.json(result('PAYMENT_APPROVED'))
  }
  await paymentApi.processPayment('order-1', {scenario:'PAYMENT_APPROVED', idempotencyKey:'test',
    cardNumber:'1234567890123456', cardCvv:'000', cardName:'Demo', amount:1})
})
