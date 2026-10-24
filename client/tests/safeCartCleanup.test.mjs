/** Verifica la limpieza selectiva con el reducer real, persistencia y handlers de Checkout en un entorno simulado. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

/** Codifica el código recibido como módulo importable en memoria. */
const dataUrl = source => 'data:text/javascript;base64,' + Buffer.from(source).toString('base64')
// Harness de handlers/estado; no sustituye las verificaciones DOM, foco o responsive.
const reducerUrl = dataUrl(ts.transpileModule(readFileSync(new URL('../src/context/cartReducer.ts', import.meta.url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ESNext } }).outputText)
const { cartReducer } = await import(reducerUrl)
const runtimeUrl = dataUrl(`
  import { cartReducer } from '${reducerUrl}';
  let slots = [], cursor = 0, effects = [];
  export let cart = []; export let cleanupCount = 0;
  export function reset(items) { slots = []; cursor = 0; effects = []; cart = items; cleanupCount = 0; }
  export function renderStart() { cursor = 0; }
  export function useState(initial) {
    const index = cursor++;
    if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial;
    return [slots[index], value => { slots[index] = typeof value === 'function' ? value(slots[index]) : value; }];
  }
  export function useRef(initial) { const [value] = useState(() => ({current:initial})); return value; }
  export function useEffect(effect) { effects.push(effect); }
  export function runEffects() { const pending = effects; effects=[]; return pending.map(effect => effect()); }
  export function useCallback(callback) { return callback; }
  export function useReducer(reducer, initial, initialize) {
    const [state, setState] = useState(() => initialize(initial));
    return [state, action => setState(current => reducer(current, action))];
  }
  export function dispatch(action) { cart = cartReducer({items:cart}, action).items; }
  export function useCart() { return {items:cart, cleanupPurchase: payload => { cleanupCount++; dispatch({type:'CLEANUP_PURCHASE', payload}); }}; }
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
modules.set('./OrderConfirmationPage', dataUrl('export default \'OrderConfirmationPage\''));
const { default: CheckoutPage } = await import(compile('pages/CheckoutPage.tsx'))
const { calculateCartTotals } = await import(calculationsUrl)
const buyer = { fullName: 'Prueba', email: 'test@example.com', phone: '88888888' }
const delivery = { province: 'San José', canton: 'Central', address: 'Dirección' }
const cart = [{ productId: 'p', name: 'Producto', image: '', price: 10000, quantity: 1, lineage: {id:'original', removed:0} }]
/** Devuelve un snapshot pendiente de prueba con comprador, entrega e importes conocidos. */
function order() {
  return { id:'order-1', orderNumber:'CN-1', createdAt:'2026-10-12T00:00:00Z', buyer, delivery,
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


const storageUrl = compile('utils/cartStorage.ts')
const { parseStoredCart, saveCart, loadCart } = await import(storageUrl)
/** Crea una línea de prueba con cantidad e identidad de incorporación explícitas. */
const item = (quantity = 2, id = 'original') => ({...cart[0], quantity, lineage:{id, removed:0}})
/** Construye la acción de limpieza con el snapshot inicial y las cantidades compradas indicadas. */
const cleanup = (baseline, purchased = baseline) => ({type:'CLEANUP_PURCHASE', payload:{baseline, purchased}})
/** Aplica al estado recibido una acción del reducer real para el producto indicado. */
const reduce = (state, type, productId = 'p') => cartReducer(state, {type, payload:{productId}})

for (const [name, current, expected] of [
  ['A unchanged', 2, 0], ['B additional quantity', 3, 1],
]) test(name, () => {
  const state = {items:[item(current)]}
  const result = cartReducer(state, cleanup([item()]))
  assert.equal(result.items[0]?.quantity ?? 0, expected)
  assert.equal(state.items[0].quantity, current)
})

test('C unrelated product survives and D reduced original closes', () => {
  const extra = {...item(1, 'other'), productId:'b'}
  const state = reduce({items:[item(), extra]}, 'DECREMENT_ITEM')
  assert.deepEqual(cartReducer(state, cleanup([item()])).items, [extra])
})

test('E remove and readd preserves a new product lifetime', () => {
  const removed = reduce({items:[item()]}, 'REMOVE_ITEM')
  const current = cartReducer(removed, {type:'ADD_ITEM', payload:item(1, 'new')})
  assert.equal(cartReducer(current, cleanup([item()])), current)
})

test('reduction then increment preserves new units and repeated cleanup is inert', () => {
  let state = reduce({items:[item()]}, 'DECREMENT_ITEM')
  state = reduce(state, 'INCREMENT_ITEM')
  const action = cleanup([item()])
  state = cartReducer(state, action)
  assert.equal(state.items[0].quantity, 1)
  state = reduce(state, 'INCREMENT_ITEM')
  assert.equal(cartReducer(state, action), state)
  assert.equal(state.items[0].quantity, 2)
})

test('authoritative quantities cap cleanup; missing purchased products survive', () => {
  const state = {items:[item(4)]}
  const result = cartReducer(state, cleanup([item(3)], [{productId:'p', quantity:1}]))
  assert.equal(result.items[0].quantity, 3)
  assert.equal(cartReducer(result, cleanup([item(3)], [{productId:'p', quantity:1}])), result)
  assert.equal(cartReducer(state, cleanup([item(3)], [])), state)
})

test('storage roundtrip and hydration retain new quantities and lineage', t => {
  const previous = globalThis.window
  let raw = null
  globalThis.window = {localStorage:{setItem:(_key, value) => {raw=value}, getItem:() => raw}}
  t.after(() => { globalThis.window = previous })
  const baseline = [item()]
  let state = reduce({items:baseline}, 'DECREMENT_ITEM')
  state = reduce(state, 'INCREMENT_ITEM')
  saveCart(state)
  assert.deepEqual(loadCart({items:[]}), state)
  state = cartReducer({items:baseline}, {type:'HYDRATE', payload:{items:parseStoredCart(raw)}})
  assert.equal(cartReducer(state, cleanup(baseline)).items[0].quantity, 1)
  assert.deepEqual(Object.keys(JSON.parse(raw)), ['items'])
})

test('legacy, corrupt metadata and ambiguous duplicate lines fail safe', () => {
  for (const lineage of [undefined, {id:'original', removed:-1}, {id:'original', removed:1.5}]) {
    const items = parseStoredCart(JSON.stringify({items:[{...item(), lineage}]}))
    const state = {items}
    assert.equal(cartReducer(state, cleanup([item()])), state)
  }
  const items = parseStoredCart(JSON.stringify({items:[item(), item()]}))
  assert.equal(items[0].quantity, 4)
  assert.equal(items[0].lineage, undefined)
})

test('pending payment updates current Cart atomically; confirmation keeps authoritative snapshot', async t => {
  const flow = await paymentFlow(t, 'PAYMENT_APPROVED')
  let resolve
  flow.respond(() => new Promise(done => {resolve=done}))
  const oldHandler = flow.payment().onProcessPayment
  const pending = oldHandler()
  await oldHandler()
  runtime.dispatch({type:'INCREMENT_ITEM', payload:{productId:'p'}})
  const extra = {...item(1, 'extra'), productId:'b'}
  runtime.dispatch({type:'ADD_ITEM', payload:extra})
  assert.equal(runtime.cleanupCount, 0)
  resolve(Response.json(result('PAYMENT_APPROVED')))
  await pending
  flow.render()
  assert.deepEqual(runtime.cart.map(i => [i.productId, i.quantity]), [['p',1], ['b',1]])
  assert.equal(flow.find('OrderConfirmationPage').order.items[0].quantity, 1)
  assert.ok(flow.events.includes('created'))
  runtime.dispatch({type:'INCREMENT_ITEM', payload:{productId:'p'}})
  flow.render(); flow.render()
  await oldHandler()
  assert.equal(runtime.cleanupCount, 1)
  assert.equal(runtime.cart[0].quantity, 2)
  assert.equal(flow.requests.length, 2)
})

test('approved unchanged purchase empties Cart while confirmation remains', async t => {
  const flow = await paymentFlow(t, 'PAYMENT_APPROVED')
  await flow.payment().onProcessPayment(); flow.render()
  assert.equal(runtime.cart.length, 0)
  assert.equal(runtime.cleanupCount, 1)
  assert.equal(flow.find('OrderConfirmationPage').order.totals.total, order().totals.total)
})

for (const scenario of ['PAYMENT_DECLINED', 'PAYMENT_ERROR']) test('no cleanup: '+scenario, async t => {
  const flow = await paymentFlow(t, scenario)
  await flow.payment().onProcessPayment(); flow.render()
  assert.equal(runtime.cleanupCount, 0)
  assert.deepEqual(runtime.cart, cart)
})

for (const failure of ['network', 'invalid', 'wrong-order', 'wrong-status']) test('no cleanup: '+failure, async t => {
  const flow = await paymentFlow(t, 'PAYMENT_APPROVED')
  flow.respond(() => {
    if (failure === 'network') throw new TypeError('offline')
    if (failure === 'invalid') return Response.json({result:'PAYMENT_APPROVED'})
    const response = result('PAYMENT_APPROVED')
    if (failure === 'wrong-order') response.order.id = 'other'
    else response.order.orderStatus = 'PENDING'
    return Response.json(response)
  })
  await flow.payment().onProcessPayment(); flow.render()
  assert.equal(runtime.cleanupCount, 0)
  assert.deepEqual(runtime.cart, cart)
  assert.ok(flow.payment().error)
})

test('confirmed creation replay preserves a new Cart and never pays', async t => {
  const original = globalThis.fetch
  t.after(() => {globalThis.fetch=original})
  let calls=0
  globalThis.fetch = async url => {
    calls++
    assert.equal(url, '/api/orders')
    return Response.json(result('PAYMENT_APPROVED').order, {status:201})
  }
  const flow = checkout()
  await flow.review().onConfirm(); flow.render()
  assert.ok(flow.find('OrderConfirmationPage'))
  assert.deepEqual(runtime.cart, cart)
  assert.equal(runtime.cleanupCount, 0)
  assert.equal(calls, 1)
})

modules.set('./CartContext', dataUrl("export const CartContext = {Provider:'CartProvider'}"))
modules.set('./cartReducer', reducerUrl)
modules.set('../utils/cartStorage', storageUrl)
const { default: CartProvider } = await import(compile('context/CartProvider.tsx'))

test('Provider migrates legacy Cart, publishes quantities, persists and accepts storage changes', t => {
  const previous = globalThis.window
  let raw = JSON.stringify({items:[{...cart[0], lineage:undefined}]})
  let storageListener
  globalThis.window = {
    localStorage:{getItem:() => raw, setItem:(_key, value) => {raw=value}},
    addEventListener:(_type, handler) => {storageListener=handler}, removeEventListener:() => {},
  }
  t.after(() => {globalThis.window=previous})
  runtime.reset([])
  /** Renderiza el Provider con hooks simulados y devuelve su API pública actual. */
  const render = () => {runtime.renderStart(); return CartProvider({children:null}).props.value}
  let value = render()
  runtime.runEffects()
  const baseline = structuredClone(value.items)
  assert.ok(baseline[0].lineage.id)
  value.incrementItem('p')
  value = render(); runtime.runEffects()
  assert.equal(value.totalUnits, 2)
  const remote = JSON.parse(raw)
  remote.items.push({...item(1, 'remote'), productId:'b'})
  storageListener({key:'cibernova:cart:v1', newValue:JSON.stringify(remote)})
  value.cleanupPurchase({baseline, purchased:[{productId:'p', quantity:1}]})
  value = render(); runtime.runEffects()
  assert.equal(value.totalUnits, 2)
  assert.deepEqual(value.items.map(i => [i.productId,i.quantity]), [['p',1],['b',1]])
  assert.deepEqual(JSON.parse(raw).items, value.items)
  value.removeItem('p')
  value.addItem(cart[0]) // Caller cannot reuse the original identity.
  value = render(); runtime.runEffects()
  assert.notEqual(value.items.find(i => i.productId === 'p').lineage.id, baseline[0].lineage.id)
  value.cleanupPurchase({baseline, purchased:[{productId:'p', quantity:1}]})
  value = render(); runtime.runEffects()
  assert.equal(value.totalUnits, 2)
})
