/** CN-66 Admin Orders: servicio real con fetch simulado, listado, búsqueda, estados, Session y Navigation Guards. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dataUrl } from './helpers/analyticsHarness.mjs'
import { reactHarness, nodes } from './helpers/reactHarness.mjs'

const buyer = { id: 'buyer', displayName: 'Cliente', role: 'B2C' }
const business = { id: 'business', displayName: 'Compras', role: 'B2B', company: { id: 'co', name: 'Empresa ficticia' } }
const admin = { id: 'admin', displayName: 'Administración', role: 'ADMIN' }
const flush = () => new Promise(resolve => setImmediate(resolve))
const rawText = tree => Array.isArray(tree) ? tree.map(rawText).join(' ')
  : tree && typeof tree === 'object' ? rawText(tree.props?.children)
  : typeof tree === 'string' || typeof tree === 'number' ? String(tree) : ''
const textOf = tree => rawText(tree).replace(/\s+/g, ' ').trim()
const deep = tree => Array.isArray(tree) ? tree.map(deep)
  : tree && typeof tree === 'object' && typeof tree.type === 'function' ? deep(tree.type(tree.props))
  : tree && typeof tree === 'object' && tree.props ? { ...tree, props: { ...tree.props, children: deep(tree.props.children) } } : tree

const summary = (id, patch = {}) => ({ id, orderNumber: 'CN-2026-' + id.toUpperCase(), createdAt: '2026-11-10T15:30:00.000Z', contractVersion: 2,
  userId: 'user-b2c-01', displayName: 'Cliente Demo', customerRole: 'B2C', company: null, branchId: 'san_jose', total: 30620, currency: 'CRC',
  orderStatus: 'PENDING', paymentStatus: 'PENDING', ...patch })
const b2bSummary = id => summary(id, { userId: 'user-b2b-01', displayName: 'Compras Empresa Demo', customerRole: 'B2B',
  company: { id: 'company-demo-01', name: 'Distribuidora Demo' }, branchId: 'heredia', orderStatus: 'CONFIRMED', paymentStatus: 'APPROVED', total: 90000 })
const page = (orders, patch = {}) => ({ orders, page: 1, pageSize: 20, total: orders.length, hasMore: false, source: 'postgresql', pendingIndexOrders: null, ...patch })

function deferredFetch(t) {
  const calls = []
  t.mock.method(globalThis, 'fetch', (url, options) => new Promise((resolve, reject) => { calls.push({ url: String(url), options, resolve, reject }) }))
  return calls
}
const ok = body => Response.json(body, { status: 200 })
const fail = (status, code) => Response.json({ error: { code, message: 'INTERNAL DETAIL' } }, { status })

async function setup(t, user = admin) {
  const h = await reactHarness()
  t.after(() => h.runtime.dispose())
  h.runtime.setUser(user)
  h.runtime.setCart({ items: [], totalUnits: 0, hasExternalConflict: false })
  h.overrides.set('components/layout/Header', dataUrl('export default "Header"'))
  h.overrides.set('components/layout/Footer', dataUrl('export default "Footer"'))
  const { default: AdminOrdersPage } = await h.load('pages/AdminOrdersPage')
  const api = await h.load('services/adminOrderApi')
  const opened = []
  const shell = { onCatalogClick() {}, onPolicyNavigate() {}, onCartClick() {} }
  const list = (props = {}) => {
    const tree = h.render('page', AdminOrdersPage, { ...shell, onOpenOrder: id => opened.push(id), ...props })
    const node = nodes(tree).find(item => typeof item.type === 'function' && item.type.name === 'AdminOrdersList')
    return { tree, node, content: node ? h.render('AdminOrdersList', node.type, node.props) : null }
  }
  return { ...h, api, list, opened }
}
const initialFilters = { q: '', orderNumber: '', userId: '', customerRole: '', branchId: '', orderStatus: '', paymentStatus: '', sort: 'newest', page: 1 }

test('adminOrderApi: GET con identidad, query sin filtros vacíos, q excluye orderNumber y valida el DTO', async t => {
  const h = await setup(t)
  const calls = deferredFetch(t)
  const request = h.api.adminOrderApi.list('admin', { ...initialFilters, orderNumber: ' CN-1 ', userId: 'user-b2b-01', customerRole: 'B2B',
    branchId: 'heredia', orderStatus: 'CONFIRMED', paymentStatus: 'APPROVED', sort: 'oldest', page: 2 })
  calls[0].resolve(ok(page([b2bSummary('a')], { page: 2, total: 21, hasMore: false })))
  assert.equal((await request).orders[0].company.name, 'Distribuidora Demo')
  assert.equal(calls[0].url, '/api/v2/admin/orders?orderNumber=CN-1&userId=user-b2b-01&customerRole=B2B&branchId=heredia&orderStatus=CONFIRMED&paymentStatus=APPROVED&sort=oldest&page=2&pageSize=20')
  assert.equal(calls[0].options.method, 'GET')
  assert.equal(calls[0].options.headers['X-CiberNova-User-Id'], 'admin')
  const search = h.api.adminOrderApi.list('admin', { ...initialFilters, q: 'Distribuidora', orderNumber: 'CN-1', sort: 'oldest' })
  calls[1].resolve(ok(page([], { source: 'algolia', pendingIndexOrders: 2, missingFromStore: 0 })))
  await search
  assert.equal(calls[1].url, '/api/v2/admin/orders?q=Distribuidora&page=1&pageSize=20')
  for (const invalid of [page([summary('a'), summary('a')]), page([summary('a', { customerRole: 'B2C', company: { id: 'c', name: 'X' } })]),
    page([summary('a', { branchId: null })]), page([summary('a', { orderStatus: 'CONFIRMED', paymentStatus: 'DECLINED' })]),
    page([summary('a', { total: -1 })]), page([summary('a')], { source: 'cache' }), page([summary('a')], { pageSize: 50 }), null]) {
    const pending = h.api.adminOrderApi.list('admin', initialFilters)
    calls.at(-1).resolve(ok(invalid))
    await assert.rejects(pending, error => error.kind === 'unavailable')
  }
  assert.ok((await (async () => { const p = h.api.adminOrderApi.list('admin', initialFilters); calls.at(-1).resolve(ok(page([summary('v1', { contractVersion: 1, branchId: null })]))); return p })()).orders.length)
})

test('adminOrderApi traduce errores sin exponer mensajes internos', async t => {
  const h = await setup(t)
  const calls = deferredFetch(t)
  for (const [response, kind] of [[fail(401, 'IDENTITY_REQUIRED'), 'session'], [fail(404, 'USER_NOT_FOUND'), 'session'], [fail(403, 'FORBIDDEN'), 'forbidden'],
    [fail(403, 'USER_DISABLED'), 'forbidden'], [fail(400, 'INVALID_ORDER_FILTER'), 'invalid-filter'], [fail(503, 'ORDER_SEARCH_UNAVAILABLE'), 'search-unavailable'],
    [fail(503, 'ORDER_QUERY_UNAVAILABLE'), 'unavailable'], [new Response('<html>', { status: 502 }), 'unavailable']]) {
    const pending = h.api.adminOrderApi.list('admin', initialFilters)
    calls.at(-1).resolve(response)
    await assert.rejects(pending, error => error instanceof h.api.AdminOrderApiError && error.kind === kind && !error.message.includes('INTERNAL'))
  }
  const network = h.api.adminOrderApi.list('admin', initialFilters)
  calls.at(-1).reject(new TypeError('Network failure'))
  await assert.rejects(network, error => error.kind === 'unavailable')
})

test('sin Session se pide identidad; B2C y B2B ven acceso no autorizado sin consultar el Server', async t => {
  for (const [user, title] of [[null, 'Selecciona una identidad'], [buyer, 'Acceso no autorizado'], [business, 'Acceso no autorizado']]) {
    const h = await setup(t, user)
    const calls = deferredFetch(t)
    const view = h.list()
    assert.equal(view.node, undefined)
    assert.match(textOf(deep(view.tree)), new RegExp(title))
    assert.match(textOf(deep(view.tree)), /órdenes/)
    assert.equal(calls.length, 0)
    t.mock.restoreAll()
  }
})

test('ADMIN: Loading, Orders de múltiples compradores con rol, empresa, sucursal, total y estados', async t => {
  const h = await setup(t)
  const calls = deferredFetch(t)
  let view = h.list()
  assert.match(textOf(view.content), /Cargando órdenes/)
  calls[0].resolve(ok(page([b2bSummary('b2b'), summary('b2c'), summary('legacy', { contractVersion: 1, branchId: null })], { total: 45, hasMore: true, pendingIndexOrders: 3 })))
  await flush()
  view = h.list()
  const rows = nodes(view.content).filter(node => node.type?.name === 'OrderRow')
  assert.deepEqual(rows.map(row => row.props.order.id), ['b2b', 'b2c', 'legacy'])
  const first = textOf(deep(rows[0])), legacy = textOf(deep(rows[2]))
  for (const expected of [/CN-2026-B2B/, /Pedido: Confirmada/, /Pago aprobado/, /B2B/, /Compras Empresa Demo · user-b2b-01/, /Distribuidora Demo/, /Heredia/, /90\s?000/, /CRC/]) {
    assert.match(first, expected)
  }
  assert.match(legacy, /No registrada/); assert.match(legacy, /Orden anterior a las condiciones comerciales/)
  assert.match(textOf(view.content), /45 órdenes · página 1 de 3/)
  assert.match(textOf(view.content), /3 órdenes aún no están indexadas para búsqueda; este listado sí las incluye/)
  // Read-Only: ningún control para crear, pagar o cambiar estados.
  assert.equal(nodes(deep(view.content)).some(node => node.type === 'button' && /Pagar|Confirmar|Cancelar|Eliminar|Editar/.test(textOf(node))), false)
})

test('filtros, búsqueda y paginación consultan al Server y vuelven a la página 1', async t => {
  const h = await setup(t)
  const calls = deferredFetch(t)
  h.list()
  calls[0].resolve(ok(page([summary('a')], { total: 45, hasMore: true })))
  await flush()
  let view = h.list()
  const control = label => nodes(view.content).find(node => node.type === 'label' && textOf(node).startsWith(label)).props.children[1]
  nodes(view.content).find(node => node.type === 'button' && textOf(node) === 'Siguiente').props.onClick()
  view = h.list()
  assert.match(textOf(view.content), /Cargando órdenes/)
  assert.match(calls[1].url, /page=2/)
  calls[1].resolve(ok(page([summary('b')], { page: 2, total: 45, hasMore: true })))
  await flush()
  view = h.list()
  control('Tipo de comprador').props.onChange({ target: { value: 'B2B' } })
  view = h.list()
  assert.match(calls[2].url, /customerRole=B2B&page=1/)
  control('Sucursal').props.onChange({ target: { value: 'cartago' } })
  control('Estado del pedido').props.onChange({ target: { value: 'PENDING' } })
  control('Estado del pago').props.onChange({ target: { value: 'DECLINED' } })
  view = h.list()
  assert.match(calls.at(-1).url, /customerRole=B2B&branchId=cartago&orderStatus=PENDING&paymentStatus=DECLINED&page=1/)
  control('Número de orden exacto').props.onChange({ target: { value: 'CN-2026-X' } })
  view = h.list()
  nodes(view.content).find(node => node.type === 'form').props.onSubmit({ preventDefault() {} })
  view = h.list()
  assert.match(calls.at(-1).url, /orderNumber=CN-2026-X/)
  // Al escribir texto de búsqueda se deshabilita el número exacto y el orden.
  control('Buscar por número').props.onChange({ target: { value: 'Distribuidora' } })
  view = h.list()
  assert.equal(control('Número de orden exacto').props.disabled, true)
  nodes(view.content).find(node => node.type === 'form').props.onSubmit({ preventDefault() {} })
  view = h.list()
  assert.match(calls.at(-1).url, /q=Distribuidora&customerRole=B2B/)
  assert.doesNotMatch(calls.at(-1).url, /orderNumber/)
  assert.equal(control('Orden').props.disabled, true)
})

test('búsqueda en el índice: aviso de consistencia eventual, índice desactualizado y Orders omitidas', async t => {
  const h = await setup(t)
  const calls = deferredFetch(t)
  h.list()
  calls[0].resolve(ok(page([summary('a', { indexOutdated: true, orderStatus: 'CONFIRMED', paymentStatus: 'APPROVED' })],
    { source: 'algolia', pendingIndexOrders: 2, missingFromStore: 1 })))
  await flush()
  const text = textOf(deep(h.list().content))
  assert.match(text, /Resultados del índice de búsqueda. El estado mostrado es el actual de PostgreSQL/)
  assert.match(text, /2 órdenes pendientes de indexar que esta búsqueda puede omitir/)
  assert.match(text, /Se omitieron 1 coincidencias del índice que ya no existen/)
  assert.match(text, /Índice desactualizado · estado actual/)
})

test('estados Empty, Error con Reintentar, filtro inválido y búsqueda no disponible', async t => {
  const h = await setup(t)
  const calls = deferredFetch(t)
  h.list()
  calls[0].resolve(fail(503, 'ORDER_QUERY_UNAVAILABLE'))
  await flush()
  let view = h.list()
  assert.match(textOf(view.content), /No pudimos consultar las órdenes en este momento. Ninguna orden ni pago fue modificado/)
  nodes(view.content).find(node => node.type === 'button' && textOf(node) === 'Reintentar').props.onClick()
  view = h.list()
  calls[1].resolve(ok(page([])))
  await flush()
  view = h.list()
  assert.match(textOf(view.content), /Sin órdenes/)
  nodes(view.content).find(node => node.type === 'button' && textOf(node) === 'Limpiar filtros').props.onClick()
  view = h.list()
  calls[2].resolve(fail(400, 'INVALID_ORDER_FILTER'))
  await flush()
  view = h.list()
  assert.match(textOf(view.content), /Los filtros seleccionados no son válidos/)
  nodes(view.content).find(node => node.type === 'button' && textOf(node) === 'Limpiar filtros').props.onClick()
  view = h.list()
  calls[3].resolve(fail(503, 'ORDER_SEARCH_UNAVAILABLE'))
  await flush()
  view = h.list()
  assert.match(textOf(view.content), /La búsqueda en el índice de órdenes no está disponible/)
  nodes(view.content).find(node => node.type === 'button' && textOf(node) === 'Ver listado sin búsqueda').props.onClick()
  view = h.list()
  assert.doesNotMatch(calls.at(-1).url, /q=/)
})

test('respuesta obsoleta: el desmontaje por cambio de Session aborta y no presenta datos anteriores', async t => {
  const h = await setup(t)
  const calls = deferredFetch(t)
  h.list()
  const stale = calls[0]
  h.runtime.unmount('AdminOrdersList')
  assert.equal(stale.options.signal.aborted, true)
  stale.resolve(ok(page([summary('from-previous-session')])))
  await flush()
  h.runtime.setUser({ ...admin, id: 'admin-2' })
  const view = h.list()
  assert.equal(view.node.props.userId, 'admin-2')
  assert.match(textOf(view.content), /Cargando órdenes/)
  assert.equal(calls.at(-1).options.headers['X-CiberNova-User-Id'], 'admin-2')
})

/** App real con páginas sustituidas: guards por hash, Header y claves por Session. */
async function setupApp(t, user, hash) {
  const h = await reactHarness()
  t.after(() => { if (globalThis.window) h.runtime.dispose() })
  h.runtime.setUser(user)
  h.runtime.setCart({ items: [], totalUnits: 0, hasExternalConflict: false })
  for (const name of ['ProductListingPage', 'CartPage', 'CheckoutPage', 'PolicyPlaceholderPage', 'TermsPage', 'ReturnsPolicyPage', 'FaqPage', 'AnalyticsDashboardPage',
    'MyOrdersPage', 'OrderDetailPage', 'AdminProductsPage', 'AdminProductDetailPage', 'AdminOrdersPage', 'AdminOrderDetailPage']) h.overrides.set('pages/' + name, dataUrl(`export default '${name}'`))
  for (const name of ['ShippingPolicyPage', 'PrivacyPolicyPage']) h.overrides.set('pages/' + name, dataUrl(`export const ${name} = '${name}'`))
  h.overrides.set('services/analytics', dataUrl('export function trackEvent() {}'))
  h.overrides.set('components/cart/CartPreviewDrawer', dataUrl('export default "CartPreviewDrawer"'))
  h.overrides.set('components/session/LoginDialog', dataUrl('export default "LoginDialog"'))
  const previous = { window: globalThis.window, raf: globalThis.requestAnimationFrame, cancel: globalThis.cancelAnimationFrame }
  globalThis.window = {
    addEventListener() {}, removeEventListener() {}, location: new URL('https://local.test/' + hash), scrollTo() {},
    history: Object.fromEntries(['pushState', 'replaceState'].map(method => [method, (_state, _title, next) => { globalThis.window.location = new URL(next, globalThis.window.location) }])),
  }
  globalThis.requestAnimationFrame = () => 1; globalThis.cancelAnimationFrame = () => {}
  t.after(() => { globalThis.window = previous.window; globalThis.requestAnimationFrame = previous.raf; globalThis.cancelAnimationFrame = previous.cancel })
  const { default: App } = await h.load('App')
  const { default: Header } = await h.load('components/layout/Header')
  const app = () => h.render('app', App)
  const find = (tree, type) => nodes(tree).find(node => node.type === type)
  return { ...h, app, find, Header }
}

test('Navigation Guards: B2C, B2B y sin Session no entran a #admin/orders; ADMIN sí, con key por Session', async t => {
  for (const user of [buyer, business, null]) {
    const h = await setupApp(t, user, '#admin/orders')
    assert.equal(h.find(h.app(), 'AdminOrdersPage'), undefined)
    assert.equal(window.location.hash, '#catalog')
  }
  const h = await setupApp(t, admin, '#admin/orders')
  const first = h.find(h.app(), 'AdminOrdersPage').key
  h.runtime.setUser({ ...admin, id: 'admin-2' })
  const second = h.find(h.app(), 'AdminOrdersPage').key
  assert.notEqual(first, second)
  assert.match(second, /admin-2/)
  h.runtime.setUser(buyer)
  assert.equal(h.find(h.app(), 'AdminOrdersPage'), undefined)
})

test('Header ofrece Órdenes solo a ADMIN y My Orders sigue para compradores', async t => {
  const h = await setupApp(t, admin, '#catalog')
  for (const [user, adminLink, myOrders] of [[admin, 1, 0], [buyer, 0, 1], [business, 0, 1], [null, 0, 0]]) {
    h.runtime.setUser(user)
    const links = nodes(h.render('header', h.Header, {})).filter(node => node.type === 'a')
    assert.equal(links.filter(link => link.props.href === '#admin/orders').length, adminLink, user?.role ?? 'null')
    assert.equal(links.filter(link => link.props.href === '#my-orders').length, myOrders, user?.role ?? 'null')
  }
  h.runtime.setUser(admin)
  const current = nodes(h.render('header', h.Header, { adminOrdersView: true })).find(node => node.type === 'a' && node.props.href === '#admin/orders')
  assert.equal(current.props['aria-current'], 'page')
})

test('Admin Orders no persiste Orders, solo usa GET y reutiliza la presentación responsive administrativa', () => {
  for (const file of ['services/adminOrderApi.ts', 'pages/AdminOrdersPage.tsx']) {
    const source = readFileSync(new URL('../src/' + file, import.meta.url), 'utf8')
    assert.doesNotMatch(source, /localStorage|sessionStorage|indexedDB/)
    assert.doesNotMatch(source, /method: '(POST|PUT|PATCH|DELETE)'/)
  }
  assert.match(readFileSync(new URL('../src/pages/AdminOrdersPage.tsx', import.meta.url), 'utf8'), /styles\/admin\/AdminProducts\.module\.css/)
})
