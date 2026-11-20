/** Verifica Checkout V2 con Session, RBAC, sucursal, Cart contextualizado, Order V2, Payment y limpieza selectiva. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { dataUrl as harnessDataUrl } from './helpers/analyticsHarness.mjs'
import { reactHarness } from './helpers/reactHarness.mjs'

/** Codifica el código recibido como módulo importable en memoria. */
const dataUrl = source => 'data:text/javascript;base64,' + Buffer.from(source).toString('base64')
// Harness de handlers/estado: Session, Branch y Cart son configurables por prueba; no sustituye pruebas DOM.
const runtimeUrl = dataUrl(`
  let slots = [], cursor = 0;
  export let state = {};
  export let cleanups = [];
  export function reset(next) { slots = []; cursor = 0; cleanups = []; state = { epoch: 0, ...next }; }
  export function setUser(user) { state = { ...state, user, epoch: state.epoch + 1 }; }
  export function setBranch(branchId) { state = { ...state, branchId }; }
  export function setItems(items) { state = { ...state, items }; }
  export function useSession() { return { user: state.user, epoch: state.epoch }; }
  export function useBranch() { return { selectedBranchId: state.branchId, branches: state.branches }; }
  export function useCart() { return { items: state.items, ownerId: state.ownerId, cleanupPurchase: payload => { cleanups.push(payload); } }; }
  export function renderStart() { cursor = 0; }
  export function useState(initial) {
    const index = cursor++;
    if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial;
    return [slots[index], value => { slots[index] = typeof value === 'function' ? value(slots[index]) : value; }];
  }
  export function useRef(initial) { const [value] = useState(() => ({ current: initial })); return value; }
  export function useEffect() {}
  export function useLayoutEffect(callback) { callback(); }
  export const Fragment = 'Fragment';
  export function jsx(type, props) { return { type, props }; }
  export const jsxs = jsx;
`)
const runtime = await import(runtimeUrl)
const modules = new Map([
  ['react', runtimeUrl], ['react/jsx-runtime', runtimeUrl],
  ['../hooks/useCart', runtimeUrl], ['../hooks/useSession', runtimeUrl], ['../hooks/useBranch', runtimeUrl],
  ['../services/analytics', dataUrl('export function trackEvent() {}')],
  ['./OrderConfirmationPage', dataUrl("export default 'OrderConfirmationPage'")],
])
for (const name of ['CheckoutStepper', 'BuyerStep', 'DeliveryStep', 'ReviewStep', 'PaymentStep', 'PaymentResultPanel', 'TermsDialog']) {
  modules.set('../components/checkout/' + name, dataUrl(`export default ${JSON.stringify(name)}`))
}
modules.set('../components/catalog/BranchSelector', dataUrl('export default "BranchSelector"'))
for (const name of ['Header', 'Footer']) modules.set('../components/layout/' + name, dataUrl(`export default ${JSON.stringify(name)}`))
/** Transpila el archivo indicado y exige que cada dependencia esté aislada por el harness. */
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
const { termsPolicy } = await import(termsUrl)
const calculationsUrl = compile('utils/cartCalculations.ts')
modules.set('./cartCalculations', calculationsUrl)
modules.set('../utils/cartCalculations', calculationsUrl)
const validationUrl = compile('utils/checkoutValidation.ts')
modules.set('../utils/checkoutValidation', validationUrl)
modules.set('../utils/orderReviewDifferences', compile('utils/orderReviewDifferences.ts'))
modules.set('../utils/authorizationErrors', compile('utils/authorizationErrors.ts'))
const apiUrl = compile('services/orderApi.ts')
modules.set('../services/orderApi', apiUrl)
modules.set('../services/paymentApi', compile('services/paymentApi.ts'))
modules.set('../services/orderHistoryApi', compile('services/orderHistoryApi.ts'))
const { default: CheckoutPage } = await import(compile('pages/CheckoutPage.tsx'))
const { default: ReviewStep } = await import(compile('components/checkout/ReviewStep.tsx'))
const { calculateCartTotals } = await import(calculationsUrl)
const { commercialIssues } = await import(validationUrl)
const { classifyOrderFailure, OrderApiError } = await import(apiUrl)

const buyer = { fullName: 'Persona Compradora', email: 'compras@example.com', phone: '88888888' }
const delivery = { province: 'San José', canton: 'Central', address: 'Dirección de prueba' }
const branches = [
  { id: 'san_jose', name: 'San José', available: true },
  { id: 'alajuela', name: 'Alajuela', available: true },
  { id: 'heredia', name: 'Heredia', available: false },
]
const b2c = { id: 'client', displayName: 'Cliente Demo', role: 'B2C' }
const b2b = { id: 'business', displayName: 'Compras Empresa Demo', role: 'B2B', company: { id: 'company-1', name: 'Distribuidora Demo' } }
const admin = { id: 'admin', displayName: 'Administración Demo', role: 'ADMIN' }
const retailLine = { productId: 'p1', name: 'Monitor', image: '', price: 10000, quantity: 1, pricingType: 'RETAIL', minimumOrderQuantity: 1,
  branchId: 'san_jose', availableQuantity: 5, inventoryStatus: 'available', commercialEligible: true, lineage: { id: 'line-1', removed: 0 } }
const wholesaleLine = { ...retailLine, price: 8000, quantity: 3, pricingType: 'WHOLESALE', minimumOrderQuantity: 3 }

/** Snapshot V2 emitido por el Server para el usuario, los productos y la sucursal indicados. */
function serverOrder(user, items, { branchId = 'san_jose', ...patch } = {}) {
  return {
    termsAcceptance: { accepted: true, version: termsPolicy.version, acceptedAt: '2026-11-17T00:00:00.000Z' },
    id: 'order-1', orderNumber: 'CN-2026-ORDER-1', createdAt: '2026-11-17T00:00:00Z', buyer, delivery,
    items: items.map(item => ({ productId: item.productId, name: item.name, image: '', unitPrice: item.price, quantity: item.quantity,
      lineSubtotal: item.price * item.quantity, minOrderQuantity: item.minimumOrderQuantity })),
    totals: calculateCartTotals(items), currency: 'CRC', orderStatus: 'PENDING', paymentStatus: 'PENDING', contractVersion: 2,
    commercial: { userId: user.id, customerRole: user.role, ...(user.role === 'B2B' ? { company: user.company } : {}), branchId,
      pricingType: user.role === 'B2B' ? 'WHOLESALE' : 'RETAIL', policyVersion: 'CIBERNOVA-COMMERCIAL-V1' },
    ...patch,
  }
}
/** Recorre el árbol JSX simulado y devuelve sus nodos. */
function nodes(tree) {
  if (Array.isArray(tree)) return tree.flatMap(nodes)
  if (!tree || typeof tree !== 'object') return []
  return [tree, ...nodes(tree.props?.children)]
}
/** Extrae el texto del árbol JSX simulado. */
function text(tree) {
  if (Array.isArray(tree)) return tree.map(text).join(' ')
  if (tree && typeof tree === 'object') return text(tree.props?.children)
  return typeof tree === 'string' || typeof tree === 'number' ? String(tree) : ''
}
/** Recorre Buyer y Delivery con el contexto indicado y devuelve controles para Review y Payment. */
function checkout({ user = b2c, items = [retailLine], ownerId = user?.id ?? null, branchId = 'san_jose', acceptTerms = true } = {}) {
  runtime.reset({ user, items: structuredClone(items), ownerId, branchId, branches })
  const events = []
  const props = { onBackToCart: () => events.push('cart'), onCatalogClick: () => events.push('catalog'), onCartClick: () => {},
    onNavigationLockChange: busy => events.push(busy), onOrderCreated: () => events.push('created'), onTransactionStateChange: state => events.push('tx:' + state) }
  let tree
  const render = () => { runtime.renderStart(); tree = CheckoutPage(props) }
  const find = type => nodes(tree).find(node => node.type === type)?.props
  render()
  find('BuyerStep').onContinue(buyer); render()
  find('DeliveryStep').onContinue(delivery); render()
  if (acceptTerms) { find('ReviewStep').onTermsAcceptedChange(true); render() }
  return { render, find, events, get tree() { return tree },
    review: () => find('ReviewStep'), payment: () => find('PaymentStep'), result: () => find('PaymentResultPanel'),
    step: () => find('CheckoutStepper')?.currentStep }
}
/** Captura URL, header de identidad y payload de cada request, y responde con el responder de la prueba. */
function mockFetch(t, responder) {
  const requests = []
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    requests.push({ url, user: options.headers['X-CiberNova-User-Id'], body: JSON.parse(options.body) })
    return responder(requests.at(-1), requests.length)
  })
  return requests
}
const paymentResult = (order, result) => ({ result, processedAt: '2026-11-17T00:01:00.000Z', order: {
  ...order, orderStatus: result === 'PAYMENT_APPROVED' ? 'CONFIRMED' : 'PENDING',
  paymentStatus: { PAYMENT_APPROVED: 'APPROVED', PAYMENT_DECLINED: 'DECLINED', PAYMENT_ERROR: 'ERROR' }[result] } })

for (const [label, user, items] of [['B2C', b2c, [retailLine]], ['B2B', b2b, [wholesaleLine]]]) {
  test(`Checkout ${label} envía Order V2 con identidad, sucursal y expectativas sin datos comerciales autoritativos`, async t => {
    const requests = mockFetch(t, () => Response.json(serverOrder(user, items), { status: 201 }))
    const flow = checkout({ user, items })
    await flow.review().onConfirm(); flow.render()
    assert.equal(requests.length, 1)
    const [request] = requests
    assert.equal(request.url, '/api/v2/orders')
    assert.equal(request.user, user.id)
    assert.equal(request.body.branchId, 'san_jose')
    assert.deepEqual(request.body.financialExpectation, calculateCartTotals(items))
    assert.deepEqual(request.body.items, items.map(({ productId, quantity }) => ({ productId, quantity })))
    for (const forbidden of ['role', 'userId', 'pricingType', 'unitPrice', 'tax', 'total', 'totals']) assert.equal(forbidden in request.body, false, forbidden)
    assert.ok(request.body.items.every(item => Object.keys(item).sort().join() === 'productId,quantity'))
    assert.equal(flow.step(), 'payment')
    assert.equal(flow.payment().order.commercial.customerRole, label)
  })
}

test('Review B2B muestra identidad, empresa, sucursal, Wholesale, MOQ y revalidación en Server', () => {
  const flow = checkout({ user: b2b, items: [wholesaleLine] })
  const review = flow.review()
  assert.deepEqual(review.commercial, { displayName: b2b.displayName, customerRole: 'B2B', companyName: 'Distribuidora Demo', branchName: 'San José', confirmedByServer: false })
  const content = text(ReviewStep(review))
  for (const expected of [/Compras Empresa Demo/, /Distribuidora Demo/, /San José/, /Wholesale/, /Mínimo de compra \(MOQ\):\s+3/, /se validan nuevamente en el servidor/]) {
    assert.match(content, expected)
  }
})

test('Review B2C muestra Retail sin empresa ni MOQ', () => {
  const content = text(ReviewStep(checkout().review()))
  assert.match(content, /Retail/)
  assert.doesNotMatch(content, /Empresa|MOQ/)
})

test('Review y Payment usan los valores autoritativos y la sucursal de la Order creada', async t => {
  const line = { ...wholesaleLine, branchId: 'alajuela' }
  const authoritative = serverOrder(b2b, [line], { branchId: 'alajuela' })
  mockFetch(t, () => Response.json(authoritative, { status: 201 }))
  const flow = checkout({ user: b2b, items: [line], branchId: 'alajuela' })
  await flow.review().onConfirm(); flow.render()
  assert.deepEqual(flow.payment().order, authoritative)
  // Un cambio posterior de selección no altera el contexto confirmado de la Order.
  runtime.setBranch('san_jose'); flow.render()
  nodes(flow.tree).find(node => node.type === 'button' && text(node) === 'Revisar orden').props.onClick(); flow.render()
  assert.equal(flow.review().commercial.branchName, 'Alajuela')
  assert.equal(flow.review().commercial.confirmedByServer, true)
  assert.deepEqual(flow.review().totals, authoritative.totals)
})

for (const [label, user] of [['sin Session', null], ['ADMIN', admin]]) {
  test(`Checkout ${label} no envía la Order`, async t => {
    const requests = mockFetch(t, () => Response.json({}, { status: 201 }))
    const flow = checkout({ user, ownerId: 'client' })
    await flow.review().onConfirm(); flow.render()
    assert.equal(requests.length, 0)
    assert.equal(flow.review().commercial, undefined)
  })
}

const blockedCases = [
  ['carrito de otro propietario', { ownerId: 'other-user' }, /otra identidad/],
  ['MOQ inválido', { user: b2b, items: [{ ...wholesaleLine, quantity: 2 }] }, /cantidad mínima es 3/],
  ['stock insuficiente', { items: [{ ...retailLine, quantity: 6 }] }, /existencias suficientes/],
  ['inventario agotado', { items: [{ ...retailLine, inventoryStatus: 'out-of-stock', availableQuantity: 0 }] }, /existencias suficientes/],
  ['contexto validado para otra sucursal', { items: [{ ...retailLine, branchId: 'alajuela' }] }, /otra sucursal/],
  ['precio de otro tipo de cliente', { user: b2b, items: [{ ...wholesaleLine, pricingType: 'RETAIL' }] }, /precio comercial vigente/],
  ['producto sin elegibilidad comercial', { items: [{ ...retailLine, commercialEligible: false }] }, /precio comercial vigente/],
]
for (const [label, options, message] of blockedCases) {
  test('Checkout bloquea antes de crear la Order: ' + label, async t => {
    const requests = mockFetch(t, () => Response.json({}, { status: 201 }))
    const flow = checkout(options)
    await flow.review().onConfirm(); flow.render()
    assert.equal(requests.length, 0)
    assert.match(flow.review().error, message)
    assert.equal(flow.review().retryPending, false)
    assert.equal(typeof flow.review().onAdjustCart, 'function', 'Orienta a corregir en el carrito')
    flow.review().onAdjustCart()
    assert.ok(flow.events.includes('cart'))
  })
}

for (const [label, branchId] of [['sin seleccionar', null], ['no disponible', 'heredia']]) {
  test('Checkout pide la sucursal en la revisión sin volver al carrito ni repetir pasos: ' + label, async t => {
    const requests = mockFetch(t, () => Response.json(serverOrder(b2c, [retailLine]), { status: 201 }))
    const flow = checkout({ branchId })
    assert.ok(flow.find('BranchSelector') !== undefined || nodes(flow.tree).some(node => node.type === 'BranchSelector'), 'El selector forma parte de la revisión')
    await flow.review().onConfirm(); flow.render()
    assert.equal(requests.length, 0)
    assert.equal(flow.step(), 'review')
    assert.equal(flow.review().onAdjustCart, undefined, 'No envía al carrito')
    assert.ok(!flow.events.includes('cart'))
    assert.match(text(nodes(flow.tree).find(node => node.props?.role === 'alert')), /Selecciona una sucursal para confirmar la compra. Tus datos de comprador y entrega se conservan/)
    runtime.setBranch('san_jose'); flow.render()
    assert.equal(nodes(flow.tree).some(node => node.props?.role === 'alert' && /Selecciona una sucursal/.test(text(node))), false)
    await flow.review().onConfirm(); flow.render()
    assert.equal(requests.length, 1)
    assert.equal(requests[0].body.branchId, 'san_jose')
    assert.deepEqual(requests[0].body.buyer, { ...buyer, fullName: buyer.fullName.trim() })
    assert.equal(flow.step(), 'payment')
    // Con una Order creada el selector desaparece: la sucursal autoritativa es la de la Order.
    assert.equal(nodes(flow.tree).some(node => node.type === 'BranchSelector'), false)
  })
}

test('commercialIssues no rebaja MOQ ni completa contexto ausente', () => {
  assert.deepEqual(commercialIssues([retailLine], 'B2C', 'san_jose'), [])
  assert.deepEqual(commercialIssues([{ productId: 'legacy', name: 'Legacy', image: '', price: 1, quantity: 1 }], 'B2C', 'san_jose'), [])
  assert.equal(commercialIssues([{ ...wholesaleLine, quantity: 1 }], 'B2B', 'san_jose')[0].kind, 'BELOW_MINIMUM_QUANTITY')
})

test('Precio comercial actualizado: el Server rechaza las expectativas y el siguiente intento usa otra key', async t => {
  const updated = { ...retailLine, price: 12000 }
  const requests = mockFetch(t, (_, count) => count === 1
    ? Response.json({ error: { code: 'CHECKOUT_VALIDATION_ERROR', message: 'INTERNAL', fieldErrors: { 'financialExpectation.subtotal': 'INTERNAL' } } }, { status: 409 })
    : Response.json(serverOrder(b2c, [updated]), { status: 201 }))
  const flow = checkout()
  await flow.review().onConfirm(); flow.render()
  assert.equal(flow.review().retryPending, false, 'El Server confirmó que no creó la Order')
  assert.match(flow.review().error, /importes cambiaron/)
  assert.equal(flow.review().error.includes('INTERNAL'), false)
  assert.equal(typeof flow.review().onAdjustCart, 'function')
  assert.equal(flow.step(), 'review')
  runtime.setItems([updated]); flow.render()
  await flow.review().onConfirm(); flow.render()
  assert.equal(requests.length, 2)
  assert.notEqual(requests[0].body.idempotencyKey, requests[1].body.idempotencyKey)
  assert.equal(requests[1].body.financialExpectation.subtotal, 12000)
  assert.equal(flow.step(), 'payment')
})

test('Una respuesta de otra sucursal o usuario no se acepta y conserva el intento para recuperarlo', async t => {
  const requests = mockFetch(t, (_, count) => Response.json(count === 1 ? serverOrder(b2c, [retailLine], { branchId: 'alajuela' })
    : count === 2 ? serverOrder(b2b, [retailLine]) : serverOrder(b2c, [retailLine]), { status: 201 }))
  const flow = checkout()
  await flow.review().onConfirm(); flow.render()
  assert.equal(flow.review().retryPending, true)
  await flow.review().onConfirm(); flow.render()
  assert.equal(flow.review().retryPending, true)
  await flow.review().onConfirm(); flow.render()
  assert.equal(flow.step(), 'payment')
  assert.equal(new Set(requests.map(request => JSON.stringify(request.body))).size, 1, 'Mismo payload y misma IdempotencyKey')
})

test('Resultado incierto por red conserva key, usuario, sucursal y payload; una Order perdida no se duplica', async t => {
  const requests = mockFetch(t, (_, count) => {
    if (count === 1) throw new TypeError('Network failure')
    if (count === 2) return Response.json({ error: { code: 'UNEXPECTED_ERROR', outcome: 'unknown' } }, { status: 503 })
    return Response.json(serverOrder(b2b, [wholesaleLine]), { status: 200 })
  })
  const flow = checkout({ user: b2b, items: [wholesaleLine] })
  await flow.review().onConfirm(); flow.render()
  assert.equal(flow.review().retryPending, true)
  assert.ok(flow.events.includes('tx:uncertain'))
  runtime.setBranch('alajuela')
  runtime.setItems([{ ...wholesaleLine, quantity: 9 }]); flow.render()
  await flow.review().onConfirm(); flow.render()
  await flow.review().onConfirm(); flow.render()
  assert.equal(requests.length, 3)
  assert.equal(new Set(requests.map(request => JSON.stringify(request))).size, 1)
  assert.equal(requests[0].body.branchId, 'san_jose')
  assert.equal(flow.step(), 'payment')
})

test('Replay de una Order ya confirmada no genera otro POST ni otro pago', async t => {
  const confirmed = serverOrder(b2c, [retailLine], { orderStatus: 'CONFIRMED', paymentStatus: 'APPROVED' })
  const requests = mockFetch(t, () => Response.json(confirmed, { status: 200 }))
  const flow = checkout()
  await flow.review().onConfirm(); flow.render()
  assert.equal(flow.tree.type, 'OrderConfirmationPage')
  assert.equal(requests.length, 1)
  assert.deepEqual(runtime.cleanups, [])
})

test('IDEMPOTENCY_CONFLICT es concluyente y no reintenta automáticamente', async t => {
  const requests = mockFetch(t, () => Response.json({ error: { code: 'CHECKOUT_VALIDATION_ERROR', fieldErrors: { idempotencyKey: 'INTERNAL' } } }, { status: 409 }))
  const flow = checkout()
  await flow.review().onConfirm(); flow.render()
  assert.equal(requests.length, 1)
  assert.equal(flow.review().retryPending, false)
  assert.match(flow.review().error, /no coincide con el intento original/)
})

const serverErrors = [
  [422, 'INVALID_MOQ', { items: 'p1' }, 'BELOW_MINIMUM_QUANTITY', 'cart', /mínimo de compra/],
  [422, 'INVALID_QUANTITY', { items: 'p1' }, 'BELOW_MINIMUM_QUANTITY', 'cart', /mínimo de compra/],
  [422, 'INSUFFICIENT_INVENTORY', { items: 'p1' }, 'INSUFFICIENT_BRANCH_STOCK', 'cart', /existencias suficientes/],
  [422, 'INVENTORY_UNAVAILABLE', { items: 'p1' }, 'INSUFFICIENT_BRANCH_STOCK', 'cart', /existencias suficientes/],
  [400, 'INVALID_BRANCH_ID', { branchId: 'p1' }, 'INVALID_BRANCH', 'cart', /sucursal/],
  [422, 'INVALID_PRODUCT_PRICE', { items: 'p1' }, 'INVALID_COMMERCIAL_PRICE', 'cart', /precio comercial/],
  [422, 'B2B_NOT_AVAILABLE', { items: 'p1' }, 'INVALID_COMMERCIAL_PRICE', 'cart', /precio comercial/],
  [404, 'PRODUCT_NOT_FOUND', undefined, 'PRODUCT_NOT_FOUND', 'cart', /ya no esta disponible/],
  [410, 'ORDER_CONTRACT_DEPRECATED', undefined, 'CLIENT_UPDATE_REQUIRED', 'none', /Recarga la página/],
  [401, 'IDENTITY_REQUIRED', undefined, 'SESSION_REQUIRED', 'none', /autorización/],
  [403, 'FORBIDDEN', undefined, 'FORBIDDEN', 'none', /autorización/],
  [503, 'USER_SERVICE_UNAVAILABLE', undefined, 'SERVICE_UNAVAILABLE', 'retry', /no está disponible/],
]
for (const [status, code, fieldErrors, kind, recovery, message] of serverErrors) {
  test(`Error ${code} orienta la corrección sin reiniciar Checkout`, async t => {
    mockFetch(t, () => Response.json({ error: { code, message: 'INTERNAL', ...(fieldErrors ? { fieldErrors } : {}) } }, { status }))
    const flow = checkout({ user: b2b, items: [wholesaleLine] })
    await flow.review().onConfirm(); flow.render()
    assert.equal(flow.step(), 'review')
    assert.match(flow.review().error, message)
    assert.equal(flow.review().error.includes('INTERNAL'), false)
    assert.equal(flow.review().retryPending, recovery === 'retry')
    assert.equal(typeof flow.review().onAdjustCart === 'function', recovery === 'cart')
    assert.equal(flow.review().authorizationRejected, ['SESSION_REQUIRED', 'FORBIDDEN'].includes(kind))
    assert.equal(flow.find('BuyerStep'), undefined, 'Buyer y Delivery conservan sus datos sin regresar al inicio')
  })
  test(`classifyOrderFailure ${code} → ${kind}`, () => {
    const error = new OrderApiError(code, status !== 503, fieldErrors)
    assert.deepEqual(classifyOrderFailure(error), { kind, recovery })
  })
}

test('INVALID_B2B_DATA de un producto no se trata como rechazo de identidad', async t => {
  mockFetch(t, () => Response.json({ error: { code: 'INVALID_B2B_DATA', fieldErrors: { items: 'p1' } } }, { status: 422 }))
  const flow = checkout({ user: b2b, items: [wholesaleLine] })
  await flow.review().onConfirm(); flow.render()
  assert.equal(flow.review().authorizationRejected, false)
  assert.equal(typeof flow.review().onAdjustCart, 'function')
})

for (const [field, step] of [['buyer.email', 'buyer'], ['delivery.address', 'delivery']]) {
  test(`Error de ${step} regresa a ${step} con sus errores de campo`, async t => {
    mockFetch(t, () => Response.json({ error: { code: 'CHECKOUT_VALIDATION_ERROR', fieldErrors: { [field]: 'Revisar' } } }, { status: 400 }))
    const flow = checkout()
    await flow.review().onConfirm(); flow.render()
    assert.equal(flow.step(), step)
    assert.deepEqual(flow.find(step === 'buyer' ? 'BuyerStep' : 'DeliveryStep').errors, { [field]: 'Revisar' })
  })
}

for (const failed of ['PAYMENT_DECLINED', 'PAYMENT_ERROR']) {
  test(`Payment B2B ${failed} permite Retry con nueva key y limpia solo el carrito propietario al aprobar`, async t => {
    const created = serverOrder(b2b, [wholesaleLine])
    const requests = mockFetch(t, (request) => {
      if (request.url === '/api/v2/orders') return Response.json(created, { status: 201 })
      assert.equal(request.url, '/api/orders/order-1/payment')
      return Response.json(paymentResult(created, request.body.scenario), { status: 200 })
    })
    const flow = checkout({ user: b2b, items: [wholesaleLine] })
    await flow.review().onConfirm(); flow.render()
    flow.payment().onScenarioChange(failed); flow.render()
    await flow.payment().onProcessPayment(); flow.render()
    assert.equal(flow.result().result, failed)
    assert.deepEqual(runtime.cleanups, [])
    flow.result().onRetry(); flow.render()
    flow.payment().onScenarioChange('PAYMENT_APPROVED'); flow.render()
    await flow.payment().onProcessPayment(); flow.render()
    const payments = requests.filter(request => request.url.endsWith('/payment'))
    assert.equal(payments.length, 2)
    assert.notEqual(payments[0].body.idempotencyKey, payments[1].body.idempotencyKey)
    assert.ok(payments.every(request => request.user === 'business'))
    assert.equal(flow.tree.type, 'OrderConfirmationPage')
    assert.equal(runtime.cleanups.length, 1)
    assert.equal(runtime.cleanups[0].ownerId, 'business')
    assert.deepEqual(runtime.cleanups[0].baseline.map(item => item.lineage), [wholesaleLine.lineage])
  })
}

test('Payment incierto conserva Order ID y key; el Retry de red no duplica el procesamiento', async t => {
  const created = serverOrder(b2c, [retailLine])
  let paymentCalls = 0
  const requests = mockFetch(t, (request) => {
    if (request.url === '/api/v2/orders') return Response.json(created, { status: 201 })
    paymentCalls += 1
    if (paymentCalls === 1) throw new TypeError('Network failure')
    return Response.json(paymentResult(created, 'PAYMENT_APPROVED'), { status: 200 })
  })
  const flow = checkout()
  await flow.review().onConfirm(); flow.render()
  flow.payment().onScenarioChange('PAYMENT_APPROVED'); flow.render()
  await flow.payment().onProcessPayment(); flow.render()
  assert.equal(flow.payment().scenarioLocked, true)
  assert.ok(flow.events.includes('tx:uncertain'))
  await flow.payment().onProcessPayment(); flow.render()
  const payments = requests.filter(request => request.url.endsWith('/payment'))
  assert.equal(payments.length, 2)
  assert.equal(payments[0].body.idempotencyKey, payments[1].body.idempotencyKey)
  assert.equal(runtime.cleanups.length, 1)
})

test('F2-01 B2B recupera la misma Order y sucursal con la identidad capturada', async t => {
  const created = serverOrder(b2b, [wholesaleLine])
  const confirmed = { ...created, orderStatus: 'CONFIRMED', paymentStatus: 'APPROVED' }
  const requests = []
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    requests.push({ url, method: options.method })
    assert.equal(options.headers['X-CiberNova-User-Id'], b2b.id)
    if (url === '/api/v2/orders') return Response.json(created, { status: 201 })
    if (options.method === 'POST') return Response.json({ error: { code: 'ORDER_ALREADY_CONFIRMED' } }, { status: 409 })
    assert.equal(url, '/api/v2/orders/' + created.id)
    assert.equal(options.method, 'GET')
    return Response.json(confirmed)
  })
  const flow = checkout({ user: b2b, items: [wholesaleLine] })
  await flow.review().onConfirm(); flow.render()
  flow.payment().onScenarioChange('PAYMENT_APPROVED'); flow.render()
  await flow.payment().onProcessPayment(); flow.render()
  assert.equal(flow.tree.type, 'OrderConfirmationPage')
  assert.deepEqual(flow.tree.props.order, confirmed)
  assert.equal(flow.tree.props.recovered, true)
  assert.equal(flow.events.at(-1), 'tx:known')
  assert.deepEqual(runtime.cleanups, [])
  assert.deepEqual(requests.map(request => request.method), ['POST', 'POST', 'GET'])
})

test('Respuesta de creación tras cambio de identidad no se aplica a la nueva Session', async t => {
  let release
  const response = new Promise(resolve => { release = resolve })
  t.mock.method(globalThis, 'fetch', () => response)
  const flow = checkout({ user: b2b, items: [wholesaleLine] })
  const pending = flow.review().onConfirm()
  runtime.setUser(b2c); flow.render()
  release(Response.json(serverOrder(b2b, [wholesaleLine]), { status: 201 }))
  await pending; flow.render()
  assert.equal(flow.events.includes('created'), false)
  assert.equal(flow.step(), 'review')
})

test('BranchProvider bloquea cambios de sucursal durante una transacción pendiente', async t => {
  const h = await reactHarness()
  t.after(() => h.runtime.dispose())
  const sessionUrl = harnessDataUrl('export let blocked=false; export function setBlocked(value){blocked=value;} export function useSession(){return {isTransactionBlocked:()=>blocked};}')
  h.overrides.set('hooks/useSession', sessionUrl)
  h.overrides.set('context/BranchContext', harnessDataUrl("export const BranchContext={Provider:'BranchContext.Provider'};"))
  h.overrides.set('services/productApi', harnessDataUrl('export async function getBranches(){return ' + JSON.stringify(branches) + ';}'))
  const session = await import(sessionUrl)
  const { default: Provider } = await h.load('context/BranchProvider')
  const value = () => h.render('provider', Provider, { children: null }).props.value
  value()
  await new Promise(resolve => setImmediate(resolve))
  value().setSelectedBranchId('san_jose')
  assert.equal(value().selectedBranchId, 'san_jose')
  session.setBlocked(true)
  value().setSelectedBranchId('alajuela')
  assert.equal(value().selectedBranchId, 'san_jose')
  session.setBlocked(false)
  value().setSelectedBranchId('alajuela')
  assert.equal(value().selectedBranchId, 'alajuela')
})
