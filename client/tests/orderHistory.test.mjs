/** CN-64 My Orders y Order Detail: servicio real con fetch simulado, páginas, Session, navegación y estados. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dataUrl } from './helpers/analyticsHarness.mjs'
import { reactHarness, nodes } from './helpers/reactHarness.mjs'

const buyer = { id: 'buyer', displayName: 'Cliente', role: 'B2C' }
const business = { id: 'business', displayName: 'Compras', role: 'B2B', company: { id: 'co', name: 'Empresa ficticia' } }
const admin = { id: 'admin', displayName: 'Administración', role: 'ADMIN' }
const flush = () => new Promise(resolve => setImmediate(resolve))
/** Como label del harness, pero conserva también los números renderizados. */
const textOf = tree => Array.isArray(tree) ? tree.map(textOf).join(' ')
  : tree && typeof tree === 'object' ? textOf(tree.props?.children)
  : typeof tree === 'string' || typeof tree === 'number' ? String(tree) : ''

const summary = (id, patch = {}) => ({ id, orderNumber: 'CN-' + id, createdAt: '2026-11-10T15:30:00.000Z', contractVersion: 2,
  branchId: 'san_jose', total: 30620, currency: 'CRC', orderStatus: 'PENDING', paymentStatus: 'PENDING', ...patch })
const historyPage = (orders, { page = 1, total = orders.length, hasMore = false } = {}) => ({ orders, page, pageSize: 10, total, hasMore })
const detail = (id, user = business, patch = {}) => ({ id, orderNumber: 'CN-' + id, createdAt: '2026-11-10T15:30:00.000Z',
  buyer: { fullName: 'Persona Compradora', email: 'compras@example.com', phone: '88888888' },
  delivery: { province: 'San José', canton: 'Central', address: 'Dirección de prueba' },
  items: [{ productId: 'p1', name: 'Monitor', image: '', unitPrice: 8000, quantity: 3, lineSubtotal: 24000, minOrderQuantity: 3 }],
  totals: { subtotal: 24000, tax: 3120, shipping: 3500, total: 30620 }, currency: 'CRC', orderStatus: 'CONFIRMED', paymentStatus: 'APPROVED',
  termsAcceptance: { accepted: true, version: '2026-10-lab4-v1', acceptedAt: '2026-11-10T15:30:00.000Z' }, contractVersion: 2,
  commercial: { userId: user.id, customerRole: user.role, ...(user.company ? { company: user.company } : {}), branchId: 'alajuela',
    pricingType: user.role === 'B2B' ? 'WHOLESALE' : 'RETAIL', policyVersion: 'CIBERNOVA-COMMERCIAL-V1' }, ...patch })

/** fetch diferido: cada request queda pendiente hasta que la prueba lo resuelve con un Response. */
function deferredFetch(t) {
  const calls = []
  t.mock.method(globalThis, 'fetch', (url, options) => new Promise((resolve, reject) => {
    calls.push({ url: String(url), options, resolve, reject })
  }))
  return calls
}
const ok = body => Response.json(body, { status: 200 })
const fail = (status, code) => Response.json({ error: { code, message: 'INTERNAL DETAIL' } }, { status })

async function setup(t, user = buyer) {
  const h = await reactHarness()
  t.after(() => h.runtime.dispose())
  h.runtime.setUser(user)
  h.runtime.setCart({ items: [], totalUnits: 0, hasExternalConflict: false })
  h.overrides.set('components/layout/Header', dataUrl('export default "Header"'))
  h.overrides.set('components/layout/Footer', dataUrl('export default "Footer"'))
  const { default: MyOrdersPage } = await h.load('pages/MyOrdersPage')
  const { default: OrderDetailPage } = await h.load('pages/OrderDetailPage')
  const api = await h.load('services/orderHistoryApi')
  const opened = []
  const shell = { onCatalogClick() {}, onPolicyNavigate() {}, onCartClick() {} }
  const component = (tree, name) => nodes(tree).find(node => typeof node.type === 'function' && node.type.name === name)
  /** Renderiza la página y, dentro de ella, el componente con estado indicado. */
  const inner = (page, props, name) => {
    const tree = h.render('page', page, props)
    const node = component(tree, name)
    return { tree, node, content: node ? h.render(name, node.type, node.props) : null }
  }
  const list = () => inner(MyOrdersPage, { ...shell, onOpenOrder: id => opened.push(id) }, 'OrderHistoryList')
  const orderDetail = (orderId, onBackToOrders = () => {}) => inner(OrderDetailPage, { ...shell, orderId, onBackToOrders }, 'OrderDetailLoader')
  return { ...h, api, list, orderDetail, opened, component }
}

test('orderHistoryApi envía la identidad, pagina por query y valida el DTO resumido', async t => {
  const h = await setup(t)
  const calls = deferredFetch(t)
  const pending = h.api.orderHistoryApi.listMine('buyer', 2, 10)
  calls[0].resolve(ok(historyPage([summary('a')], { page: 2, total: 11 })))
  assert.deepEqual((await pending).orders, [summary('a')])
  assert.equal(calls[0].url, '/api/v2/orders/mine?page=2&pageSize=10')
  assert.equal(calls[0].options.headers['X-CiberNova-User-Id'], 'buyer')
  assert.equal(calls[0].options.method, 'GET')
  for (const invalid of [
    historyPage([summary('a'), summary('a')]), { ...historyPage([summary('a')]), page: 3 },
    historyPage([summary('a', { branchId: null })]), historyPage([summary('a', { orderStatus: 'CONFIRMED', paymentStatus: 'DECLINED' })]),
    historyPage([summary('a', { total: -1 })]), { orders: null }, null,
  ]) {
    const request = h.api.orderHistoryApi.listMine('buyer', 1, 10)
    calls.at(-1).resolve(ok(invalid))
    await assert.rejects(request, error => error.kind === 'unavailable')
  }
  const v1 = h.api.orderHistoryApi.listMine('buyer', 1, 10)
  calls.at(-1).resolve(ok(historyPage([summary('legacy', { contractVersion: 1, branchId: null })])))
  assert.equal((await v1).orders[0].branchId, null, 'Una Order V1 sin sucursal es válida')
})

test('orderHistoryApi traduce errores sin exponer mensajes internos', async t => {
  const h = await setup(t)
  const calls = deferredFetch(t)
  for (const [response, kind] of [[fail(401, 'IDENTITY_REQUIRED'), 'session'], [fail(404, 'USER_NOT_FOUND'), 'session'],
    [fail(403, 'FORBIDDEN'), 'forbidden'], [fail(403, 'USER_DISABLED'), 'forbidden'], [fail(404, 'ORDER_NOT_FOUND'), 'not-found'],
    [fail(503, 'UNEXPECTED_ERROR'), 'unavailable']]) {
    const request = h.api.orderHistoryApi.getOrder('buyer', 'x')
    calls.at(-1).resolve(response)
    await assert.rejects(request, error => error instanceof h.api.OrderHistoryApiError && error.kind === kind && !error.message.includes('INTERNAL'))
  }
  const network = h.api.orderHistoryApi.listMine('buyer', 1, 10)
  calls.at(-1).reject(new TypeError('Network failure'))
  await assert.rejects(network, error => error.kind === 'unavailable')
})

test('orderHistoryApi codifica el Order ID y rechaza un detalle de otra Order u otro propietario', async t => {
  const h = await setup(t, business)
  const calls = deferredFetch(t)
  const valid = h.api.orderHistoryApi.getOrder('business', 'a/b c')
  calls[0].resolve(ok(detail('a/b c')))
  assert.equal((await valid).id, 'a/b c')
  assert.equal(calls[0].url, '/api/v2/orders/a%2Fb%20c')
  for (const body of [detail('other-id'), detail('a/b c', buyer)]) {
    const request = h.api.orderHistoryApi.getOrder('business', 'a/b c')
    calls.at(-1).resolve(ok(body))
    await assert.rejects(request, error => error.kind === 'unavailable')
  }
})

test('My Orders sin Session pide elegir identidad y ADMIN no consulta el historial', async t => {
  for (const [user, title] of [[null, 'Selecciona una identidad'], [admin, 'Acceso no autorizado']]) {
    const h = await setup(t, user)
    const calls = deferredFetch(t)
    const { tree, node } = h.list()
    assert.equal(node, undefined, 'No se monta la consulta')
    const notice = h.component(tree, 'AccessNotice')
    assert.match(textOf(h.render('notice', notice.type, notice.props)), new RegExp(title))
    assert.equal(calls.length, 0)
    t.mock.restoreAll()
  }
})

test('My Orders B2C: Loading, listado en orden del Server y acceso al detalle', async t => {
  const h = await setup(t)
  const calls = deferredFetch(t)
  let view = h.list()
  assert.match(textOf(view.content), /Cargando tus órdenes/)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].options.headers['X-CiberNova-User-Id'], 'buyer')
  const orders = [summary('newest', { orderStatus: 'CONFIRMED', paymentStatus: 'APPROVED' }), summary('older', { branchId: 'heredia', paymentStatus: 'DECLINED', total: 1500 })]
  calls[0].resolve(ok(historyPage(orders)))
  await flush()
  view = h.list()
  const cards = nodes(view.content).filter(node => node.type?.name === 'OrderCard')
  assert.deepEqual(cards.map(card => card.props.order.id), ['newest', 'older'])
  const first = textOf(cards[0].type(cards[0].props)), second = textOf(cards[1].type(cards[1].props))
  assert.match(first, /CN-newest/); assert.match(first, /Confirmada/); assert.match(first, /Pago aprobado/); assert.match(first, /San José/)
  assert.match(second, /Heredia/); assert.match(second, /Pago rechazado/); assert.match(second, /1\s?500/)
  const link = nodes(cards[1].type(cards[1].props)).find(node => node.type === 'a')
  assert.equal(link.props.href, '#my-orders/older')
  const event = (patch = {}) => ({ defaultPrevented: false, button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false,
    currentTarget: { target: '' }, preventDefault() { this.defaultPrevented = true }, ...patch })
  link.props.onClick(event({ ctrlKey: true }))
  assert.deepEqual(h.opened, [], 'Ctrl+click queda en manos del navegador')
  link.props.onClick(event())
  assert.deepEqual(h.opened, ['older'])
  assert.equal(nodes(view.content).some(node => node.type === 'button' && /Cargar más/.test(textOf(node))), false)
})

test('My Orders presenta Empty State real y Error con Reintentar', async t => {
  const h = await setup(t)
  const calls = deferredFetch(t)
  h.list()
  calls[0].resolve(fail(503, 'UNEXPECTED_ERROR'))
  await flush()
  let view = h.list()
  assert.match(textOf(view.content), /No pudimos cargar tus órdenes/)
  nodes(view.content).find(node => node.type === 'button').props.onClick()
  view = h.list()
  assert.match(textOf(view.content), /Cargando/)
  assert.equal(calls.length, 2)
  calls[1].resolve(ok(historyPage([])))
  await flush()
  view = h.list()
  assert.match(textOf(view.content), /Todavía no tienes órdenes/)
  assert.equal(nodes(view.content).some(node => node.type?.name === 'OrderCard'), false, 'Sin datos ficticios')
})

test('Cargar más agrega la página siguiente sin duplicados y comunica su error', async t => {
  const h = await setup(t)
  const calls = deferredFetch(t)
  h.list()
  calls[0].resolve(ok(historyPage(Array.from({ length: 10 }, (_, index) => summary('o' + index)), { total: 12, hasMore: true })))
  await flush()
  let view = h.list()
  const more = () => nodes(view.content).find(node => node.type === 'button' && /Cargar más|Cargando más/.test(textOf(node)))
  assert.match(textOf(view.content), /Mostrando\s+10\s+de\s+12/)
  more().props.onClick()
  view = h.list()
  assert.equal(more().props.disabled, true)
  assert.match(calls[1].url, /page=2&pageSize=10/)
  calls[1].reject(new TypeError('Network failure'))
  await flush()
  view = h.list()
  assert.match(textOf(view.content), /No pudimos cargar más órdenes/)
  assert.equal(nodes(view.content).filter(node => node.type?.name === 'OrderCard').length, 10, 'Conserva lo ya cargado')
  more().props.onClick()
  // o9 se repite porque una Order nueva desplazó el offset; no debe duplicarse.
  calls[2].resolve(ok(historyPage([summary('o9'), summary('o10'), summary('o11')], { page: 2, total: 12, hasMore: false })))
  await flush()
  view = h.list()
  const ids = nodes(view.content).filter(node => node.type?.name === 'OrderCard').map(node => node.props.order.id)
  assert.equal(ids.length, 12)
  assert.equal(new Set(ids).size, 12)
  assert.equal(more(), undefined)
})

test('cambio de usuario: la consulta anterior se cancela y su respuesta tardía no se aplica', async t => {
  const h = await setup(t)
  const calls = deferredFetch(t)
  h.list()
  const stale = calls[0]
  // App remonta My Orders con otra key al cambiar Session; el desmontaje cancela la request.
  h.runtime.unmount('OrderHistoryList')
  assert.equal(stale.options.signal.aborted, true)
  h.runtime.setUser(business)
  h.list()
  assert.equal(calls[1].options.headers['X-CiberNova-User-Id'], 'business')
  stale.resolve(ok(historyPage([summary('from-buyer')])))
  calls[1].resolve(ok(historyPage([summary('from-business')])))
  await flush()
  const ids = nodes(h.list().content).filter(node => node.type?.name === 'OrderCard').map(node => node.props.order.id)
  assert.deepEqual(ids, ['from-business'])
})

test('Order Detail B2B muestra el snapshot histórico sin recalcular importes', async t => {
  const h = await setup(t, business)
  const calls = deferredFetch(t)
  let back = 0
  let view = h.orderDetail('order-1', () => back++)
  assert.match(textOf(view.content), /Cargando el detalle/)
  // Totales deliberadamente distintos de la suma de líneas: deben mostrarse tal como vienen del Server.
  calls[0].resolve(ok(detail('order-1', business, { totals: { subtotal: 1, tax: 2, shipping: 3, total: 4 } })))
  await flush()
  view = h.orderDetail('order-1', () => back++)
  const content = nodes(view.content).find(node => node.type?.name === 'OrderDetailContent')
  const text = textOf(content.type(content.props))
  for (const expected of [/CN-order-1/, /order-1/, /Persona Compradora/, /B2B/, /Wholesale/, /Empresa ficticia/, /Alajuela/, /Monitor/,
    /Mínimo de compra \(MOQ\):\s+3/, /Pago aprobado/, /Confirmada/, /2026-10-lab4-v1/]) assert.match(text, expected)
  assert.match(text, /8\s?000/)
  assert.match(text, /24\s?000/)
  assert.match(text, /₡\s?4,00|4,00/)
  assert.doesNotMatch(text, /30\s?620/)
  nodes(view.content).find(node => typeof node.type === 'function' && node.type.name === 'BackButton').props.onBack()
  assert.equal(back, 1)
})

test('Order Detail V1 informa la información comercial ausente sin inventarla', async t => {
  const h = await setup(t)
  const calls = deferredFetch(t)
  h.orderDetail('legacy')
  const legacy = detail('legacy', buyer)
  delete legacy.commercial
  delete legacy.contractVersion
  calls[0].resolve(ok(legacy))
  await flush()
  const content = nodes(h.orderDetail('legacy').content).find(node => node.type?.name === 'OrderDetailContent')
  const text = textOf(content.type(content.props))
  assert.match(text, /anterior a las condiciones comerciales/)
  assert.doesNotMatch(text, /Empresa|Wholesale|Retail|MOQ/)
})

test('Order Detail: inexistente o ajena, Session requerida y Reintentar', async t => {
  const h = await setup(t)
  const calls = deferredFetch(t)
  h.orderDetail('foreign')
  calls[0].resolve(fail(404, 'ORDER_NOT_FOUND'))
  await flush()
  assert.match(textOf(h.orderDetail('foreign').content), /No encontramos esta orden/)
  h.runtime.unmount('OrderDetailLoader')
  h.orderDetail('x')
  calls[1].resolve(fail(401, 'IDENTITY_REQUIRED'))
  await flush()
  const notice = h.component(h.orderDetail('x').content, 'AccessNotice')
  assert.equal(notice.props.kind, 'session')
  h.runtime.unmount('OrderDetailLoader')
  h.orderDetail('y')
  calls[2].resolve(fail(503, 'UNEXPECTED_ERROR'))
  await flush()
  const view = h.orderDetail('y')
  nodes(view.content).find(node => node.type === 'button' && /Reintentar/.test(textOf(node))).props.onClick()
  h.orderDetail('y')
  assert.equal(calls.length, 4)
})

/** App real con páginas aisladas: valida hash directo, guards, Back/Forward e invalidación por Session. */
async function setupApp(t, user, hash) {
  const h = await reactHarness()
  // Si otro entorno ya restauró window, sus listeners ya no existen y no hay nada que limpiar.
  t.after(() => { if (globalThis.window) h.runtime.dispose() })
  h.runtime.setUser(user)
  h.runtime.setCart({ items: [], totalUnits: 0, hasExternalConflict: false })
  for (const name of ['ProductListingPage', 'CartPage', 'CheckoutPage', 'PolicyPlaceholderPage', 'TermsPage', 'ReturnsPolicyPage', 'FaqPage',
    'AnalyticsDashboardPage', 'MyOrdersPage', 'OrderDetailPage']) h.overrides.set('pages/' + name, dataUrl(`export default '${name}'`))
  for (const name of ['ShippingPolicyPage', 'PrivacyPolicyPage']) h.overrides.set('pages/' + name, dataUrl(`export const ${name} = '${name}'`))
  h.overrides.set('services/analytics', dataUrl('export function trackEvent() {}'))
  h.overrides.set('components/cart/CartPreviewDrawer', dataUrl('export default "CartPreviewDrawer"'))
  h.overrides.set('components/session/LoginDialog', dataUrl('export default "LoginDialog"'))
  const listeners = new Map(), history = []
  const previous = { window: globalThis.window, raf: globalThis.requestAnimationFrame, cancel: globalThis.cancelAnimationFrame }
  globalThis.window = {
    addEventListener: (type, callback) => listeners.set(type, callback), removeEventListener: type => listeners.delete(type),
    location: new URL('https://local.test/' + hash), scrollTo() {},
    history: Object.fromEntries(['pushState', 'replaceState'].map(method => [method, (_state, _title, next) => {
      history.push({ method, next }); globalThis.window.location = new URL(next, globalThis.window.location)
    }])),
  }
  globalThis.requestAnimationFrame = () => 1; globalThis.cancelAnimationFrame = () => {}
  t.after(() => { globalThis.window = previous.window; globalThis.requestAnimationFrame = previous.raf; globalThis.cancelAnimationFrame = previous.cancel })
  const { default: App } = await h.load('App')
  const { default: Header } = await h.load('components/layout/Header')
  const app = () => h.render('app', App)
  const find = (tree, type) => nodes(tree).find(node => node.type === type)
  return { ...h, app, find, history, listeners, Header }
}

test('acceso directo por hash, apertura del detalle y Back al listado para B2C', async t => {
  const h = await setupApp(t, buyer, '#my-orders')
  let tree = h.app()
  const page = h.find(tree, 'MyOrdersPage')
  assert.ok(page)
  page.props.onOpenOrder('order 1/x')
  tree = h.app()
  assert.equal(window.location.hash, '#my-orders/order%201%2Fx')
  assert.equal(h.history.at(-1).method, 'pushState')
  assert.equal(h.find(tree, 'OrderDetailPage').props.orderId, 'order 1/x')
  window.location = new URL('https://local.test/#my-orders')
  h.listeners.get('popstate')()
  tree = h.app()
  assert.ok(h.find(tree, 'MyOrdersPage'))
  assert.equal(h.find(tree, 'OrderDetailPage'), undefined)
  window.location = new URL('https://local.test/#my-orders/order%201%2Fx')
  h.listeners.get('hashchange')()
  tree = h.app()
  h.find(tree, 'OrderDetailPage').props.onBackToOrders()
  tree = h.app()
  assert.equal(window.location.hash, '#my-orders')
  assert.ok(h.find(tree, 'MyOrdersPage'))
})

test('recarga directa del detalle conserva el Order ID; un hash mal formado vuelve al catálogo', async t => {
  const h = await setupApp(t, business, '#my-orders/abc%20123')
  assert.equal(h.find(h.app(), 'OrderDetailPage').props.orderId, 'abc 123')
  const broken = await setupApp(t, business, '#my-orders/%E0%A4%A')
  const tree = broken.app()
  assert.equal(broken.find(tree, 'OrderDetailPage'), undefined)
  assert.ok(broken.find(tree, 'ProductListingPage').props.active)
})

test('Navigation Guard: ADMIN no entra a My Orders por hash ni por navegación interna', async t => {
  for (const hash of ['#my-orders', '#my-orders/any']) {
    const h = await setupApp(t, admin, hash)
    const tree = h.app()
    assert.equal(h.find(tree, 'MyOrdersPage'), undefined)
    assert.equal(h.find(tree, 'OrderDetailPage'), undefined)
    assert.equal(window.location.hash, '#catalog')
  }
})

test('cambio de Session remonta My Orders con otra key y ADMIN la revoca', async t => {
  const h = await setupApp(t, buyer, '#my-orders')
  const first = h.find(h.app(), 'MyOrdersPage').key
  h.runtime.setUser(business)
  const second = h.find(h.app(), 'MyOrdersPage').key
  assert.notEqual(first, second)
  assert.match(second, /business/)
  h.runtime.setUser(admin)
  const tree = h.app()
  assert.equal(h.find(tree, 'MyOrdersPage'), undefined)
})

test('Header ofrece Mis órdenes solo a compradores con Session', async t => {
  const h = await setupApp(t, buyer, '#catalog')
  for (const [user, visible] of [[buyer, true], [business, true], [admin, false], [null, false]]) {
    h.runtime.setUser(user)
    const links = nodes(h.render('header', h.Header, {})).filter(node => node.type === 'a' && node.props.href === '#my-orders')
    assert.equal(links.length, visible ? 1 : 0, user?.role ?? 'null')
  }
  h.runtime.setUser(buyer)
  const current = nodes(h.render('header', h.Header, { ordersView: true })).find(node => node.type === 'a' && node.props.href === '#my-orders')
  assert.equal(current.props['aria-current'], 'page')
})

test('Order History no persiste Orders en el navegador y adapta la presentación a Tablet y Mobile', () => {
  for (const file of ['services/orderHistoryApi.ts', 'pages/MyOrdersPage.tsx', 'pages/OrderDetailPage.tsx']) {
    assert.doesNotMatch(readFileSync(new URL('../src/' + file, import.meta.url), 'utf8'), /localStorage|sessionStorage|indexedDB/)
  }
  const css = readFileSync(new URL('../src/styles/orders/OrderHistory.module.css', import.meta.url), 'utf8')
  assert.match(css, /\.list \{[^}]*repeat\(2, minmax\(0, 1fr\)\)/)
  assert.match(css, /@media \(max-width: 960px\)[^@]*\.list \{ grid-template-columns: minmax\(0, 1fr\)/)
  assert.match(css, /@media \(max-width: 600px\)[^@]*content: attr\(data-label\)/)
})
