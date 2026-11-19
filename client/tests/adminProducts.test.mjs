/** CN-67 Admin Products: servicio real con fetch simulado, páginas, estados, Session, guards y presentación responsive. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dataUrl } from './helpers/analyticsHarness.mjs'
import { reactHarness, nodes } from './helpers/reactHarness.mjs'

const buyer = { id: 'buyer', displayName: 'Cliente', role: 'B2C' }
const business = { id: 'business', displayName: 'Compras', role: 'B2B', company: { id: 'co', name: 'Empresa ficticia' } }
const admin = { id: 'admin', displayName: 'Administración', role: 'ADMIN' }
const flush = () => new Promise(resolve => setImmediate(resolve))
const textOf = tree => Array.isArray(tree) ? tree.map(textOf).join(' ')
  : tree && typeof tree === 'object' ? textOf(tree.props?.children)
  : typeof tree === 'string' || typeof tree === 'number' ? String(tree) : ''
/** Renderiza recursivamente los componentes función para inspeccionar el texto final. */
const deep = tree => Array.isArray(tree) ? tree.map(deep)
  : tree && typeof tree === 'object' && typeof tree.type === 'function' ? deep(tree.type(tree.props))
  : tree && typeof tree === 'object' && tree.props ? { ...tree, props: { ...tree.props, children: deep(tree.props.children) } } : tree

const branches = (quantities, moq = 3) => ['san_jose', 'alajuela', 'cartago', 'heredia'].map((branchId, index) => ({
  branchId, name: ['San José', 'Alajuela', 'Cartago', 'Heredia'][index], quantity: quantities[index],
  status: quantities[index] === null ? 'invalid' : quantities[index] === 0 ? 'out-of-stock' : moq !== null && quantities[index] < moq ? 'below-moq' : 'available',
}))
const product = (id, patch = {}) => ({
  id, sku: 'SKU-' + id, title: 'Producto ' + id, brand: 'Marca', categories: ['Almacenamiento', 'SSD'], image: null, currency: 'CRC',
  pricing: { retailPrice: 45000, wholesalePrice: 39000, b2bAvailable: true, minOrderQuantity: 3, b2bStatus: 'eligible' },
  inventory: { globalStock: 30, branchTotal: 30, availability: 'limited', insufficientForMoq: false, branches: branches([20, 2, 0, 8]) },
  issues: [], ...patch,
})
const page = (products, patch = {}) => ({ products, page: 1, pageSize: 12, total: products.length, totalPages: 1,
  facets: { categories: { Almacenamiento: 2 }, brands: { Marca: 2 } }, ...patch })

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
  const { default: AdminProductsPage } = await h.load('pages/AdminProductsPage')
  const { default: AdminProductDetailPage } = await h.load('pages/AdminProductDetailPage')
  const api = await h.load('services/adminProductApi')
  const filters = await h.load('utils/adminProductFilters')
  const opened = []
  const shell = { onCatalogClick() {}, onPolicyNavigate() {}, onCartClick() {} }
  const component = (tree, name) => nodes(tree).find(node => typeof node.type === 'function' && node.type.name === name)
  const inner = (pageComponent, props, name) => {
    const tree = h.render('page', pageComponent, props)
    const node = component(tree, name)
    return { tree, node, content: node ? h.render(name, node.type, node.props) : null }
  }
  const list = () => inner(AdminProductsPage, { ...shell, onOpenProduct: id => opened.push(id) }, 'AdminProductCatalog')
  const detail = (productId, onBack = () => {}) => inner(AdminProductDetailPage, { ...shell, productId, onBack }, 'AdminProductLoader')
  return { ...h, api, filters, list, detail, opened, component }
}

test('adminProductApi: GET con identidad, query sin filtros vacíos y validación del DTO', async t => {
  const h = await setup(t)
  const calls = deferredFetch(t)
  const filters = { ...h.filters.INITIAL_ADMIN_FILTERS, q: ' ssd ', branchId: 'alajuela', availability: 'below-moq', b2b: 'eligible', sort: 'stock_desc', page: 2 }
  const request = h.api.adminProductApi.list('admin', filters)
  calls[0].resolve(ok(page([product('a')], { page: 2, totalPages: 2, total: 13 })))
  assert.equal((await request).products[0].id, 'a')
  assert.equal(calls[0].url, '/api/v2/admin/products?q=ssd&branchId=alajuela&availability=below-moq&b2b=eligible&sort=stock_desc&page=2&pageSize=12')
  assert.equal(calls[0].options.method, 'GET')
  assert.equal(calls[0].options.headers['X-CiberNova-User-Id'], 'admin')
  for (const invalid of [
    page([product('a'), product('a')]), page([product('a', { inventory: { ...product('a').inventory, branches: branches([1, 2, 3]) } })]),
    page([product('a', { inventory: { ...product('a').inventory, branches: [...branches([1, 2, 3, 4])].reverse() } })]),
    page([product('a', { pricing: { ...product('a').pricing, retailPrice: -1 } })]), page([product('a', { currency: 'USD' })]),
    page([product('a', { issues: ['UNKNOWN'] })]), page([product('a')], { pageSize: 50 }), { products: null }, null,
  ]) {
    const pending = h.api.adminProductApi.list('admin', h.filters.INITIAL_ADMIN_FILTERS)
    calls.at(-1).resolve(ok(invalid))
    await assert.rejects(pending, error => error.kind === 'unavailable')
  }
  const detailRequest = h.api.adminProductApi.get('admin', 'a/b c')
  calls.at(-1).resolve(ok(product('a/b c')))
  assert.equal((await detailRequest).id, 'a/b c')
  assert.equal(calls.at(-1).url, '/api/v2/admin/products/a%2Fb%20c')
  const otherProduct = h.api.adminProductApi.get('admin', 'x')
  calls.at(-1).resolve(ok(product('y')))
  await assert.rejects(otherProduct, error => error.kind === 'unavailable')
})

test('adminProductApi traduce errores del Server sin exponer mensajes internos', async t => {
  const h = await setup(t)
  const calls = deferredFetch(t)
  for (const [response, kind] of [[fail(401, 'IDENTITY_REQUIRED'), 'session'], [fail(404, 'USER_NOT_FOUND'), 'session'],
    [fail(403, 'FORBIDDEN'), 'forbidden'], [fail(403, 'USER_DISABLED'), 'forbidden'], [fail(404, 'PRODUCT_NOT_FOUND'), 'not-found'],
    [fail(400, 'INVALID_PRODUCT_FILTER'), 'invalid-filter'], [fail(400, 'INVALID_BRANCH_ID'), 'invalid-filter'],
    [fail(503, 'CATALOG_UNAVAILABLE'), 'unavailable'], [new Response('<html>', { status: 502 }), 'unavailable']]) {
    const pending = h.api.adminProductApi.get('admin', 'x')
    calls.at(-1).resolve(response)
    await assert.rejects(pending, error => error instanceof h.api.AdminProductApiError && error.kind === kind && !error.message.includes('INTERNAL'))
  }
  const network = h.api.adminProductApi.list('admin', h.filters.INITIAL_ADMIN_FILTERS)
  calls.at(-1).reject(new TypeError('Network failure'))
  await assert.rejects(network, error => error.kind === 'unavailable')
})

test('sin Session se pide identidad; B2C y B2B reciben acceso no autorizado sin consultar el Server', async t => {
  for (const [user, title] of [[null, 'Selecciona una identidad'], [buyer, 'Acceso no autorizado'], [business, 'Acceso no autorizado']]) {
    const h = await setup(t, user)
    const calls = deferredFetch(t)
    for (const view of [h.list(), h.detail('a')]) {
      assert.equal(view.node, undefined)
      const notice = h.component(view.tree, 'AdminAccessNotice')
      assert.match(textOf(h.render('notice', notice.type, notice.props)), new RegExp(title))
    }
    assert.equal(calls.length, 0)
    t.mock.restoreAll()
  }
})

test('ADMIN: Loading, tarjetas con Retail/Wholesale/MOQ, cuatro sucursales y acceso al detalle', async t => {
  const h = await setup(t)
  const calls = deferredFetch(t)
  let view = h.list()
  assert.match(textOf(view.content), /Cargando productos/)
  const products = [product('ssd'), product('router', { pricing: { ...product('x').pricing, b2bStatus: 'not-available', b2bAvailable: false },
    inventory: { globalStock: 0, branchTotal: 0, availability: 'out-of-stock', insufficientForMoq: false, branches: branches([0, 0, 0, 0]) } })]
  calls[0].resolve(ok(page(products)))
  await flush()
  view = h.list()
  const cards = nodes(view.content).filter(node => node.type?.name === 'ProductCard')
  assert.deepEqual(cards.map(card => card.props.product.id), ['ssd', 'router'])
  const first = textOf(deep(cards[0])), second = textOf(deep(cards[1]))
  assert.match(first, /45\s?000/); assert.match(first, /39\s?000/); assert.match(first, /3 unidades/)
  for (const branch of ['San José', 'Alajuela', 'Cartago', 'Heredia']) assert.match(first, new RegExp(branch))
  assert.match(first, /Stock limitado/); assert.match(first, /Menor al MOQ B2B/); assert.match(first, /SKU SKU-ssd/); assert.match(first, /30 unidades/)
  assert.match(second, /Agotado/); assert.match(second, /B2B no disponible/)
  assert.match(textOf(view.content), /2\s+productos\s+·\s+página\s+1\s+de\s+1/)
  const link = nodes(deep(cards[1])).find(node => node.type === 'a')
  assert.equal(link.props.href, '#admin/products/router')
  const event = (patch = {}) => ({ defaultPrevented: false, button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false,
    currentTarget: { target: '' }, preventDefault() { this.defaultPrevented = true }, ...patch })
  link.props.onClick(event({ metaKey: true }))
  assert.deepEqual(h.opened, [])
  link.props.onClick(event())
  assert.deepEqual(h.opened, ['router'])
  // Read-Only: ningún control de edición en la vista.
  assert.equal(nodes(deep(view.content)).some(node => node.type === 'button' && /Editar|Guardar|Eliminar|Modificar/.test(textOf(node))), false)
})

test('filtros y paginación consultan al Server, vuelven a la página 1 y descartan "limitado" por sucursal', async t => {
  const h = await setup(t)
  const calls = deferredFetch(t)
  h.list()
  calls[0].resolve(ok(page([product('a')], { total: 30, totalPages: 3 })))
  await flush()
  let view = h.list()
  const select = label => nodes(view.content).find(node => node.type === 'label' && textOf(node).startsWith(label)).props.children[1]
  nodes(view.content).find(node => node.type === 'button' && textOf(node) === 'Siguiente').props.onClick()
  view = h.list()
  assert.match(textOf(view.content), /Cargando productos/)
  assert.match(calls[1].url, /page=2/)
  calls[1].resolve(ok(page([product('b')], { page: 2, total: 30, totalPages: 3 })))
  await flush()
  view = h.list()
  select('Disponibilidad').props.onChange({ target: { value: 'limited' } })
  view = h.list()
  assert.match(calls[2].url, /availability=limited&page=1/)
  select('Sucursal').props.onChange({ target: { value: 'cartago' } })
  view = h.list()
  assert.match(calls[3].url, /branchId=cartago&page=1/)
  assert.doesNotMatch(calls[3].url, /availability/)
  const availabilityOptions = nodes(select('Disponibilidad')).filter(node => node.type === 'option').map(node => node.props.value)
  assert.deepEqual(availabilityOptions, ['', 'available', 'below-moq', 'out-of-stock', 'invalid'])
  const form = nodes(view.content).find(node => node.type === 'form')
  const input = nodes(form).find(node => node.type === 'input')
  input.props.onChange({ target: { value: 'SAM-DIS-0214' } })
  view = h.list()
  nodes(view.content).find(node => node.type === 'form').props.onSubmit({ preventDefault() {} })
  view = h.list()
  assert.match(calls.at(-1).url, /q=SAM-DIS-0214&branchId=cartago&page=1/)
  assert.deepEqual(h.filters.withFilter({ ...h.filters.INITIAL_ADMIN_FILTERS, page: 4 }, { brand: 'Dell' }).page, 1)
})

test('estados Empty, Error con Reintentar y filtro inválido con Limpiar filtros', async t => {
  const h = await setup(t)
  const calls = deferredFetch(t)
  h.list()
  calls[0].resolve(fail(503, 'CATALOG_UNAVAILABLE'))
  await flush()
  let view = h.list()
  assert.match(textOf(view.content), /No pudimos consultar el catálogo/)
  nodes(view.content).find(node => node.type === 'button' && textOf(node) === 'Reintentar').props.onClick()
  view = h.list()
  calls[1].resolve(ok(page([])))
  await flush()
  view = h.list()
  assert.match(textOf(view.content), /Sin resultados/)
  assert.equal(nodes(view.content).some(node => node.type?.name === 'ProductCard'), false)
  nodes(view.content).find(node => node.type === 'button' && textOf(node) === 'Limpiar filtros').props.onClick()
  view = h.list()
  calls[2].resolve(fail(400, 'INVALID_PRODUCT_FILTER'))
  await flush()
  view = h.list()
  assert.match(textOf(view.content), /filtros seleccionados no son válidos/)
})

test('respuesta obsoleta: el desmontaje por cambio de Session aborta y no presenta datos anteriores', async t => {
  const h = await setup(t)
  const calls = deferredFetch(t)
  h.list()
  const stale = calls[0]
  h.runtime.unmount('AdminProductCatalog')
  assert.equal(stale.options.signal.aborted, true)
  stale.resolve(ok(page([product('from-previous-session')])))
  await flush()
  h.runtime.setUser({ ...admin, id: 'admin-2' })
  const view = h.list()
  assert.equal(view.node.props.userId, 'admin-2')
  assert.match(textOf(view.content), /Cargando productos/)
  assert.equal(calls.at(-1).options.headers['X-CiberNova-User-Id'], 'admin-2')
})

test('detalle: identificación, precios, MOQ, inventario global vs sucursales, inconsistencias y 404', async t => {
  const h = await setup(t)
  const calls = deferredFetch(t)
  let backs = 0
  let view = h.detail('ssd', () => backs++)
  assert.match(textOf(view.content), /Cargando producto/)
  calls[0].resolve(ok(product('ssd', { issues: ['STOCK_TOTAL_MISMATCH'],
    inventory: { ...product('ssd').inventory, globalStock: 31 } })))
  await flush()
  view = h.detail('ssd', () => backs++)
  const text = textOf(deep(view.content))
  for (const expected of [/SKU-ssd/, /Almacenamiento › SSD/, /Precio Retail \(B2C\)/, /45\s?000/, /Precio Wholesale \(B2B\)/, /39\s?000/,
    /MOQ B2B\s+3 unidades/, /Stock global del catálogo\s+31 unidades/, /Suma de las sucursales\s+30 unidades/,
    /stock global no coincide/, /San José/, /Alajuela/, /Cartago/, /Heredia/]) assert.match(text, expected)
  nodes(view.content).find(node => node.type === 'button' && textOf(node) === 'Volver a productos').props.onClick()
  assert.equal(backs, 1)

  h.runtime.unmount('AdminProductLoader')
  view = h.detail('missing')
  calls.at(-1).resolve(fail(404, 'PRODUCT_NOT_FOUND'))
  await flush()
  view = h.detail('missing')
  assert.match(textOf(view.content), /Producto no encontrado/)
})

test('detalle B2B distingue habilitado, deshabilitado y disponibilidad inválida con su advertencia', async t => {
  for (const [name, available, status, label, invalid] of [
    ['habilitado', true, 'eligible', 'B2B habilitado', false],
    ['deshabilitado', false, 'not-available', 'B2B no disponible', false],
    ['disponibilidad inválida', null, 'invalid', 'Condiciones B2B inválidas', true],
  ]) {
    await t.test(name, async child => {
      const h = await setup(child)
      const calls = deferredFetch(child)
      const record = product('b2b-detail')
      record.pricing = { ...record.pricing, b2bAvailable: available, b2bStatus: status }
      if (status !== 'eligible') record.inventory.branches = branches([20, 2, 0, 8], null)
      record.issues = invalid ? ['B2B_DATA_INVALID'] : []
      h.detail(record.id)
      calls[0].resolve(ok(record))
      await flush()
      const text = textOf(deep(h.detail(record.id).content))
      assert.match(text, new RegExp(label))
      assert.match(text, /45\s?000/)
      assert.match(text, /39\s?000/)
      assert.match(text, /MOQ B2B\s+3 unidades/)
      if (invalid) {
        assert.match(text, /Disponibilidad B2B\s+No registrada/)
        assert.match(text, /Las condiciones B2B \(disponibilidad, precio mayorista o MOQ\) no son válidas/)
      } else {
        assert.doesNotMatch(text, /Las condiciones B2B.*no son válidas/)
        assert.match(text, available ? /Disponibilidad B2B\s+Habilitado/ : /Disponibilidad B2B\s+Deshabilitado/)
      }
    })
  }
})

/** App real con páginas aisladas: guards por hash, navegación interna e invalidación por Session. */
async function setupApp(t, user, hash) {
  const h = await reactHarness()
  t.after(() => { if (globalThis.window) h.runtime.dispose() })
  h.runtime.setUser(user)
  h.runtime.setCart({ items: [], totalUnits: 0, hasExternalConflict: false })
  for (const name of ['ProductListingPage', 'CartPage', 'CheckoutPage', 'PolicyPlaceholderPage', 'TermsPage', 'ReturnsPolicyPage', 'FaqPage',
    'AnalyticsDashboardPage', 'MyOrdersPage', 'OrderDetailPage', 'AdminProductsPage', 'AdminProductDetailPage']) h.overrides.set('pages/' + name, dataUrl(`export default '${name}'`))
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
  const navigation = await h.load('utils/appNavigation')
  const app = () => h.render('app', App)
  const find = (tree, type) => nodes(tree).find(node => node.type === type)
  return { ...h, app, find, history, listeners, Header, navigation }
}

test('Navigation Guards: B2C, B2B y sin Session no entran por hash; ADMIN abre listado y detalle', async t => {
  for (const user of [buyer, business, null]) {
    for (const hash of ['#admin/products', '#admin/products/qa-ssd']) {
      const h = await setupApp(t, user, hash)
      const tree = h.app()
      assert.equal(h.find(tree, 'AdminProductsPage'), undefined)
      assert.equal(h.find(tree, 'AdminProductDetailPage'), undefined)
      assert.equal(window.location.hash, '#catalog')
    }
  }
  const h = await setupApp(t, admin, '#admin/products')
  let tree = h.app()
  h.find(tree, 'AdminProductsPage').props.onOpenProduct('qa ssd/1')
  tree = h.app()
  assert.equal(window.location.hash, '#admin/products/qa%20ssd%2F1')
  assert.equal(h.find(tree, 'AdminProductDetailPage').props.productId, 'qa ssd/1')
  h.find(tree, 'AdminProductDetailPage').props.onBack()
  tree = h.app()
  assert.equal(window.location.hash, '#admin/products')
  assert.ok(h.find(tree, 'AdminProductsPage'))
  assert.equal(h.navigation.viewFromHash('#admin/products/%E0%A4%A'), 'catalog')
})

test('cambio de Session remonta Admin Products con otra key y un comprador la revoca', async t => {
  const h = await setupApp(t, admin, '#admin/products')
  const first = h.find(h.app(), 'AdminProductsPage').key
  h.runtime.setUser({ ...admin, id: 'admin-2' })
  const second = h.find(h.app(), 'AdminProductsPage').key
  assert.notEqual(first, second)
  assert.match(second, /admin-2/)
  h.runtime.setUser(buyer)
  assert.equal(h.find(h.app(), 'AdminProductsPage'), undefined)
})

test('Header ofrece Productos solo a ADMIN y marca la vista activa', async t => {
  const h = await setupApp(t, admin, '#catalog')
  for (const [user, visible] of [[admin, true], [buyer, false], [business, false], [null, false]]) {
    h.runtime.setUser(user)
    const links = nodes(h.render('header', h.Header, {})).filter(node => node.type === 'a' && node.props.href === '#admin/products')
    assert.equal(links.length, visible ? 1 : 0, user?.role ?? 'null')
  }
  h.runtime.setUser(admin)
  const current = nodes(h.render('header', h.Header, { adminProductsView: true })).find(node => node.type === 'a' && node.props.href === '#admin/products')
  assert.equal(current.props['aria-current'], 'page')
})

test('Read-Only y responsive: solo GET, sin persistencia en el navegador y tarjetas en Tablet/Mobile', () => {
  for (const file of ['services/adminProductApi.ts', 'pages/AdminProductsPage.tsx', 'pages/AdminProductDetailPage.tsx']) {
    const source = readFileSync(new URL('../src/' + file, import.meta.url), 'utf8')
    assert.doesNotMatch(source, /localStorage|sessionStorage|indexedDB/)
    assert.doesNotMatch(source, /method: '(POST|PUT|PATCH|DELETE)'/)
  }
  const css = readFileSync(new URL('../src/styles/admin/AdminProducts.module.css', import.meta.url), 'utf8')
  assert.match(css, /\.list \{[^}]*repeat\(2, minmax\(0, 1fr\)\)/)
  assert.match(css, /@media \(max-width: 960px\)[^@]*\.list \{ grid-template-columns: minmax\(0, 1fr\)/)
  assert.match(css, /@media \(max-width: 600px\)[^@]*content: attr\(data-label\)/)
})
