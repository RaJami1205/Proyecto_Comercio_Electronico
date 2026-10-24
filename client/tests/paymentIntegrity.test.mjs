/** Verifica intentos de pago, validación de respuestas y campos demostrativos con servicios reales y fetch simulado. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

/** Codifica el código recibido como módulo importable en memoria. */
const dataUrl = source => 'data:text/javascript;base64,' + Buffer.from(source).toString('base64')
// Harness de handlers/estado; no sustituye las verificaciones DOM, foco o responsive.
const reducerUrl = dataUrl(ts.transpileModule(readFileSync(new URL('../src/context/cartReducer.ts', import.meta.url), 'utf8'), {compilerOptions:{target:ts.ScriptTarget.ES2023, module:ts.ModuleKind.ESNext}}).outputText)
const runtimeUrl = dataUrl(`
  import { cartReducer } from '${reducerUrl}';
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
  export function useCart() { return {items:cart, cleanupPurchase: payload => { cleanupCount++; cart = cartReducer({items:cart}, {type:'CLEANUP_PURCHASE', payload}).items; }}; }
  export const Fragment = 'Fragment';
  export function jsx(type, props) { return {type, props}; }
  export const jsxs = jsx;
`)
const runtime = await import(runtimeUrl)
const modules = new Map([
  ['react', runtimeUrl], ['react/jsx-runtime', runtimeUrl],
  ['../hooks/useCart', runtimeUrl],
])
for (const name of ['CheckoutStepper', 'BuyerStep', 'DeliveryStep', 'ReviewStep', 'PaymentStep', 'PaymentResultPanel', 'TermsDialog']) {
  modules.set('../components/checkout/' + name, dataUrl(`export default ${JSON.stringify(name)}`))
}
for (const name of ['Header', 'Footer']) modules.set('../components/layout/' + name, dataUrl(`export default ${JSON.stringify(name)}`))
/** Transpila el archivo indicado y resuelve únicamente las dependencias aisladas del harness. */
function compile(file) {
  const source = readFileSync(new URL('../src/' + file, import.meta.url), 'utf8').replace('import.meta.env.VITE_API_BASE_URL', 'undefined')
  const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX } }).outputText
  return dataUrl(js.replace(/from ['"]([^'"]+)['"]/g, (_, dependency) => {
    const target = dependency.endsWith('.css') ? dataUrl('export default {}') : modules.get(dependency)
    assert.ok(target, 'Dependencia sin aislar: ' + dependency)
    return 'from ' + JSON.stringify(target)
  }))
}
const termsUrl = compile('content/terms.ts')
modules.set('../content/terms', termsUrl)
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
modules.set('./OrderConfirmationPage', dataUrl("export default 'OrderConfirmationPage'"))
const { default: CheckoutPage } = await import(compile('pages/CheckoutPage.tsx'))
const { calculateCartTotals } = await import(calculationsUrl)
const buyer = { fullName: 'Prueba', email: 'test@example.com', phone: '88888888' }
const delivery = { province: 'San José', canton: 'Central', address: 'Dirección' }
const cart = [{ productId: 'p', name: 'Producto', image: '', price: 10000, quantity: 1, lineage:{id:'original', removed:0} }]
/** Devuelve un snapshot pendiente de prueba con comprador, entrega e importes conocidos. */
function order() {
  return { termsAcceptance:{accepted:true,version:'2026-10-lab4-v1',acceptedAt:'2026-10-12T00:00:00.000Z'}, id:'order-1', orderNumber:'CN-1', createdAt:'2026-10-12T00:00:00Z', buyer, delivery,
    items:[{productId:'p', name:'Producto', image:'', unitPrice:10000, quantity:1, lineSubtotal:10000}],
    totals:calculateCartTotals(cart), currency:'CRC', orderStatus:'PENDING', paymentStatus:'PENDING' }
}
/** Recorre el árbol JSX simulado y devuelve sus nodos para inspeccionar propiedades. */
function nodes(tree) {
  if (Array.isArray(tree)) return tree.flatMap(nodes)
  if (!tree || typeof tree !== 'object') return []
  return [tree, ...nodes(tree.props?.children)]
}
/** Inicializa el Cart y recorre Buyer y Delivery; devuelve controles del harness para probar Review y Payment. */
function checkout({ acceptTerms = true } = {}) {
  runtime.reset(structuredClone(cart))
  const events = []
  const props = { onBackToCart: () => events.push('exit'), onCatalogClick: () => {}, onCartClick: () => {},
    onNavigationLockChange: busy => events.push(busy), onOrderCreated: () => events.push('created') }
  let tree
  /** Actualiza el árbol simulado de Checkout conservando sus slots de estado. */
  const render = () => { runtime.renderStart(); tree = CheckoutPage(props) }
  /** Devuelve las propiedades del primer componente del tipo solicitado en el árbol simulado. */
  const find = type => nodes(tree).find(node => node.type === type)?.props
  render()
  find('BuyerStep').onContinue(buyer)
  render()
  find('DeliveryStep').onContinue(delivery)
  render()
  if (acceptTerms) { find('ReviewStep').onTermsAcceptedChange(true); render() }
  return { render, find, review: () => find('ReviewStep'), step: () => find('CheckoutStepper').currentStep, events }
}

/** Construye un resultado de pago coherente con el escenario; permite sustituir campos para probar respuestas inválidas. */
const result = (scenario, changes = {}) => ({
  result: scenario, processedAt: order().createdAt,
  order: {...order(), orderStatus: scenario === 'PAYMENT_APPROVED' ? 'CONFIRMED' : 'PENDING',
    paymentStatus: scenario.replace('PAYMENT_', '')}, ...changes,
})
/** Prepara la Order y el escenario solicitado con fetch simulado; devuelve handlers y requests capturados. */
async function paymentFlow(t, scenario = 'PAYMENT_DECLINED') {
  const original = globalThis.fetch
  t.after(() => { globalThis.fetch = original })
  const requests = []
  /** Construye la respuesta simulada para el escenario incluido en la solicitud de pago. */
  let respond = request => Response.json(result(request.scenario))
  globalThis.fetch = async (url, options) => {
    assert.equal(options.method, 'POST')
    const payload = JSON.parse(options.body)
    assert.equal(typeof payload.idempotencyKey, 'string')
    assert.ok(payload.idempotencyKey.length > 0)
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
  assert.equal(flow.find('OrderConfirmationPage'), undefined)
  assert.equal(runtime.cleanupCount, 0)
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
    assert.equal(runtime.cleanupCount, 0)
    assert.equal(flow.find('OrderConfirmationPage'), undefined)
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
  assert.equal(runtime.cleanupCount, 1)
  assert.deepEqual(runtime.cart, [])
  assert.equal(flow.find('PaymentResultPanel'), undefined)
  assert.equal(flow.find('PaymentStep'), undefined)
  assert.equal(flow.find('OrderConfirmationPage').onRetry, undefined)
  assert.equal(flow.find('OrderConfirmationPage').order.orderStatus, 'CONFIRMED')
  assert.deepEqual(flow.find('OrderConfirmationPage').order, result('PAYMENT_APPROVED').order)
  assert.equal(flow.requests.length, 2)
})

const invalidTerms = [
  undefined, null, [], {},
  ...[false, 'true', 1].map(accepted=>({...order().termsAcceptance, accepted})),
  ...[undefined, '', ' ', 1, null].map(version=>({...order().termsAcceptance, version})),
  ...[undefined, null, 1, '', 'invalid', '2026-10-12', '10/12/2026', '2026-02-30T00:00:00.000Z', '2026-10-12T00:00:00Z'].map(acceptedAt=>({...order().termsAcceptance, acceptedAt})),
]
const invalidResults = [
  ...invalidTerms.map((termsAcceptance,index)=>['CN-47 metadata inválida '+index,()=>result('PAYMENT_APPROVED',{order:{...result('PAYMENT_APPROVED').order,termsAcceptance}})]),
  ['Approved/Pending', () => result('PAYMENT_APPROVED', {order:order()})],
  ['Order ajena', () => result('PAYMENT_APPROVED', {order:{...result('PAYMENT_APPROVED').order, id:'other'}})],
  ['escenario ajeno', () => result('PAYMENT_DECLINED')],
  ['escenario desconocido', () => result('PAYMENT_UNKNOWN')],
  ['resultado ausente', () => result('PAYMENT_APPROVED', {result:undefined})],
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
    assert.equal(flow.find('OrderConfirmationPage'), undefined)
    assert.equal(runtime.cleanupCount, 0)
    assert.ok(flow.payment().error)
    assert.equal(flow.payment().scenarioLocked, true)
    flow.respond(() => Response.json(result('PAYMENT_APPROVED')))
    await flow.payment().onProcessPayment(); flow.render()
    assert.deepEqual(flow.requests[1], flow.requests[2])
    assert.equal(flow.find('OrderConfirmationPage').order.orderStatus, 'CONFIRMED')
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

const { default: PaymentStep } = await import(compile('components/checkout/PaymentStep.tsx'))
const { default: PaymentResultPanel } = await import(compile('components/checkout/PaymentResultPanel.tsx'))

test('Sandbox conserva campos demo, validación, escenarios y payload sin datos de tarjeta', async t => {
  runtime.reset([])
  const writes = [], logs = [], requests = []
  const storage = {setItem: (...args) => writes.push(args)}
  for (const key of ['localStorage', 'sessionStorage', 'window']) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, key)
    Object.defineProperty(globalThis, key, {configurable:true, value:key === 'window' ? {localStorage:storage, sessionStorage:storage} : storage})
    t.after(() => {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else delete globalThis[key]
    })
  }
  for (const method of ['log', 'info', 'warn', 'error', 'debug']) t.mock.method(console, method, (...args) => logs.push(args))
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    requests.push({url, payload:JSON.parse(options.body)})
    return Response.json(result('PAYMENT_APPROVED'))
  })
  const props = {order:order(), selectedScenario:null, isProcessingPayment:false,
    onScenarioChange: scenario => { props.selectedScenario = scenario },
    onProcessPayment: () => paymentApi.processPayment('order-1', {scenario:props.selectedScenario, idempotencyKey:'demo-key'})}
  let tree
  /** Actualiza el árbol simulado del formulario de pago con las propiedades actuales. */
  const render = () => { runtime.renderStart(); tree = PaymentStep(props) }
  /** Devuelve los campos demostrativos del formulario, excluyendo los selectores de escenario. */
  const inputs = () => nodes(tree).filter(n => n.type === 'input' && n.props.type !== 'radio')
  /** Devuelve las propiedades del botón de procesamiento del formulario simulado. */
  const button = () => nodes(tree).find(n => n.type === 'button').props
  /** Devuelve los grupos del formulario para comprobar su estado habilitado o bloqueado. */
  const fieldsets = () => nodes(tree).filter(n => n.type === 'fieldset')
  render()
  assert.equal(inputs().length, 4)
  assert.equal(inputs()[3].props.type, 'password')
  assert.equal(nodes(tree).filter(n => n.type === 'input' && n.props.type === 'radio').length, 3)
  assert.equal(button().disabled, true)
  const values = ['1234567890123456', 'Persona Demo', '1399', '000']
  inputs().forEach((input, index) => input.props.onChange({target:{value:values[index]}}))
  render()
  assert.equal(inputs()[0].props.value, '1234 5678 9012 3456')
  assert.equal(inputs()[2].props.value, '13/99')
  const radio = nodes(tree).find(n => n.type === 'input' && n.props.value === 'PAYMENT_APPROVED')
  radio.props.onChange(); render()
  assert.equal(button().disabled, true) // mes inválido
  inputs()[2].props.onChange({target:{value:'1299'}}); render()
  assert.equal(button().disabled, false)
  await button().onClick()
  assert.deepEqual(requests, [{url:'/api/orders/order-1/payment', payload:{scenario:'PAYMENT_APPROVED', idempotencyKey:'demo-key'}}])
  props.isProcessingPayment = true; render()
  assert.equal(button().disabled, true)
  assert.ok(fieldsets().every(n => n.props.disabled))
  props.isProcessingPayment = false; props.scenarioLocked = true; render()
  assert.equal(Boolean(fieldsets()[0].props.disabled), false)
  assert.equal(fieldsets()[1].props.disabled, true)
  assert.equal(inputs()[0].props.value, '1234 5678 9012 3456')
  assert.deepEqual(writes, [])
  assert.deepEqual(logs, [])
})

for (const scenario of ['PAYMENT_APPROVED', 'PAYMENT_DECLINED', 'PAYMENT_ERROR']) {
  test('Panel real presenta ' + scenario + ' y disponibilidad correcta de Retry', () => {
    runtime.reset([])
    let retries = 0
    const payment = result(scenario)
    const tree = PaymentResultPanel({result:scenario, order:payment.order,
      onRetry:scenario === 'PAYMENT_APPROVED' ? undefined : () => { retries++ }})
    assert.equal(tree.props.role, scenario === 'PAYMENT_APPROVED' ? 'status' : 'alert')
    assert.equal(nodes(tree).find(n => n.type === 'h3').props.tabIndex, -1)
    const buttons = nodes(tree).filter(n => n.type === 'button')
    assert.equal(buttons.length, scenario === 'PAYMENT_APPROVED' ? 0 : 1)
    if (buttons.length) { buttons[0].props.onClick(); assert.equal(retries, 1) }
  })
}

test('CN-47 PaymentApi conserva consentimiento histórico válido',async t=>{
  const historical=result('PAYMENT_APPROVED')
  historical.order.termsAcceptance.version='historical-test-version'
  t.mock.method(globalThis,'fetch',async()=>Response.json(historical))
  assert.deepEqual(await paymentApi.processPayment('order-1',{scenario:'PAYMENT_APPROVED',idempotencyKey:'history'}),historical)
})
