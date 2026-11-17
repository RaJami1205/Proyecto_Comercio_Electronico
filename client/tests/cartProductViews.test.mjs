/** CartPage/Quick View/Collector reales; lifecycle controlado, storage y HTTP simulados. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { analyticsEnvironment, loadAnalytics, dataUrl } from './helpers/analyticsHarness.mjs'
import { reactHarness, nodes, label } from './helpers/reactHarness.mjs'

const product = id => ({ id, name: 'Producto ' + id, image: '', price: 1000.125, retailPrice: 1000.125,
  pricing: { type: 'RETAIL', eligible: true, minOrderQuantity: 1, message: null },
  inventory: { branchId: 'san_jose', quantity: 10, status: 'available', canFulfillMinimum: true, message: '10 disponibles' },
  canAddToCart: true, inStock: true, category: 'Almacenamiento', description: 'Actual', specifications: [] })
const quickView = tree => nodes(tree).find(node => node.type?.name === 'ProductQuickView')
const tick = () => new Promise(resolve => setImmediate(resolve))

async function flow(t, user = { id: 'u', role: 'B2C' }, realCart = false) {
  const h = await reactHarness()
  t.after(() => h.runtime.dispose())
  const env = analyticsEnvironment(t), { api, url } = await loadAnalytics()
  h.overrides.set('services/analytics', url)
  // El harness permite controlar el commit también para el efecto de layout de la guarda de Session.
  h.overrides.set('react', dataUrl(`export * from '${h.url}'; export { useEffect as useLayoutEffect } from '${h.url}';`))
  for (const name of ['Header', 'Footer']) h.overrides.set('components/layout/' + name, dataUrl(`export default '${name}'`))
  h.overrides.set('components/catalog/CartFeedbackToast', dataUrl('export default "CartFeedbackToast"'))
  if (!realCart) h.overrides.set('components/cart/CartSection', dataUrl('export default "CartSection"'))
  h.overrides.set('hooks/useBranch', dataUrl('export function useBranch(){return {selectedBranchId:"san_jose"}}'))
  const listeners = new Map()
  window.addEventListener = (name, callback) => {
    if (!listeners.has(name)) listeners.set(name, new Set())
    listeners.get(name).add(callback)
  }
  window.removeEventListener = (name, callback) => listeners.get(name)?.delete(callback)
  env.listeners.add(event => listeners.get(event.type)?.forEach(callback => callback(event)))
  const previousDocument = Object.getOwnPropertyDescriptor(globalThis, 'document')
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { addEventListener() {}, removeEventListener() {} } })
  t.after(() => {
    if (previousDocument) Object.defineProperty(globalThis, 'document', previousDocument)
    else delete globalThis.document
  })
  const requests = []
  t.mock.method(globalThis, 'fetch', async (url, options = {}) => {
    const request = new URL(String(url), 'http://local.test')
    assert.equal(request.pathname, '/api/products')
    const ids = request.searchParams.getAll('ids')
    assert.ok(ids.length <= 10)
    requests.push({ ids, userId: options.headers?.['X-CiberNova-User-Id'] })
    return Response.json({ products: ids.map(product) })
  })
  h.runtime.setUser(user)
  h.runtime.setCart({ items: [{ productId: 'p1', name: 'Producto p1', image: '', price: 1000.125, quantity: 1 }],
    totalUnits: 1, ownerId: user?.id ?? null, isActive: true, hasExternalConflict: false, hasInvalidStorage: false,
    updateProductContext() {}, incrementItem() {}, decrementItem() {}, removeItem() {},
    addItem() { assert.fail('Abrir/cerrar Quick View desde Cart no agrega productos.') } })
  const { default: Page } = await h.load('pages/CartPage')
  const props = { onCartClick() {}, onContinueShopping() {}, onCheckoutRequested() {}, onPolicyNavigate() {} }
  let tree
  const render = (commit = true) => { tree = h.render('cart-page', Page, props, commit); return tree }
  const openHandler = () => nodes(tree).find(node => node.type === 'CartSection' || node.type?.name === 'CartSection').props.onProductSelect
  const drawQuick = () => {
    const quick = quickView(tree)
    if (quick) return h.render('quick-view', quick.type, quick.props)
    h.runtime.unmount('quick-view')
    return null
  }
  render()
  return { ...h, ...env, api, requests, renderComponent: h.render, render, openHandler, drawQuick, get tree() { return tree },
    open(id) { openHandler()(product(id)); render(); return drawQuick() },
    close() { quickView(tree).props.onClose(); render(); return drawQuick() },
    setUser(value, commit = true) { h.runtime.setUser(value); return render(commit) },
  }
}

for (const user of [{ id: 'u', role: 'B2C' }, { id: 'business', role: 'B2B', company: { id: 'co', name: 'Empresa' } },
  { id: 'admin', role: 'ADMIN' }, null]) {
  test('Cart abre Quick View y emite una sola visualización v2 en el scope ' + (user?.role ?? 'Anonymous'), async t => {
    const f = await flow(t, user)
    assert.equal(f.api.getAnalyticsCounters(user?.id).productViews, 0)
    const dialog = f.open('p1')
    assert.ok(nodes(dialog).some(node => node.type === 'dialog'))
    assert.equal(quickView(f.tree).props.showAddToCart, false)
    assert.equal(nodes(dialog).some(node => node.type === 'button' && /Agregar/.test(node.props.title ?? '')), false)
    const [event] = f.api.getAnalyticsEvents(user?.id)
    assert.equal(f.api.getAnalyticsEvents(user?.id).length, 1)
    assert.equal(event.type, 'PRODUCT_VIEWED')
    assert.equal(event.userId, user?.id ?? null)
    assert.equal(event.schemaVersion, 2)
    assert.deepEqual(event.metadata, { productId: 'p1' })
    assert.ok(event.eventId)
    assert.equal(new Date(event.occurredAt).toISOString(), event.occurredAt)
    assert.equal(f.api.getAnalyticsCounters(user?.id).cartAdds, 0)
    if (user) assert.equal(f.api.getAnalyticsCounters().productViews, 0)
    await f.api.flushAnalytics()
  })
}

test('cerrar, re-render y repetir efectos no cuentan; reabrir el mismo producto es otra visita legítima', async t => {
  const f = await flow(t)
  f.open('p1')
  for (let index = 0; index < 3; index++) { f.render(); f.drawQuick(); f.runtime.replay('cart-page') }
  assert.equal(f.api.getAnalyticsCounters('u').productViews, 1)
  f.close()
  assert.equal(quickView(f.tree), undefined)
  assert.equal(f.api.getAnalyticsCounters('u').productViews, 1)
  f.open('p1')
  assert.equal(f.api.getAnalyticsCounters('u').productViews, 2)
  assert.deepEqual(f.api.getRecentlyViewedProductIds('u'), ['p1'])
  const events = f.api.getAnalyticsEvents('u')
  assert.notEqual(events[0].eventId, events[1].eventId)
  await f.api.flushAnalytics()
})

test('Session invalida selección y callbacks anteriores incluso tras Logout y volver al mismo userId', async t => {
  const f = await flow(t)
  const original = f.openHandler()
  f.open('p1')
  // El snapshot anterior deja de mostrarse ya durante el nuevo render, antes del commit.
  f.setUser({ id: 'other', role: 'B2C' }, false)
  assert.equal(quickView(f.tree), undefined)
  f.runtime.commit('cart-page')
  original(product('stale'))
  f.render()
  assert.equal(quickView(f.tree), undefined)
  const other = f.openHandler()
  f.open('p2')
  f.setUser(null)
  other(product('stale-other'))
  assert.equal(f.api.getAnalyticsCounters('other').productViews, 1)
  assert.equal(f.api.getAnalyticsCounters().productViews, 0)
  f.setUser({ id: 'u', role: 'B2C' })
  original(product('stale-same-id'))
  f.render()
  assert.equal(quickView(f.tree), undefined)
  f.open('p3')
  assert.deepEqual(f.api.getAnalyticsEvents('u').map(event => event.metadata.productId), ['p1', 'p3'])
  assert.deepEqual(f.api.getRecentlyViewedProductIds('other'), ['p2'])
  assert.deepEqual(f.api.getRecentlyViewedProductIds('u'), ['p3', 'p1'])
  await f.api.flushAnalytics()
})

test('un callback retenido después de desmontar CartPage no abre ni registra visualizaciones', async t => {
  const f = await flow(t), open = f.openHandler()
  f.runtime.unmount('cart-page')
  open(product('late'))
  assert.deepEqual(f.api.getAnalyticsEvents('u'), [])
  await f.api.flushAnalytics()
})

test('Catalog y Cart conservan la misma semántica y un único evento por apertura', async t => {
  const f = await flow(t)
  f.overrides.set('hooks/useProductCatalog', dataUrl('export function useProductCatalog(){return {products:[{id:"catalog"}],totalPages:1,nbHits:1,facets:{},isLoading:false,error:null}}'))
  for (const name of ['CatalogFilters', 'CatalogHero', 'CatalogToolbar', 'Pagination', 'ProductGrid']) {
    f.overrides.set('components/catalog/' + name, dataUrl(`export default '${name}'`))
  }
  const { default: Catalog } = await f.load('pages/ProductListingPage')
  const props = { active: true, isCartPreviewOpen: false, onCartClick() {}, onProductAdded() {}, onPolicyNavigate() {} }
  const drawCatalog = () => f.renderComponent('catalog', Catalog, props)
  nodes(drawCatalog()).find(node => node.type === 'ProductGrid').props.onProductSelect(product('catalog'))
  assert.ok(quickView(drawCatalog()))
  f.open('cart')
  f.render(); drawCatalog()
  assert.deepEqual(f.api.getAnalyticsEvents('u').map(event => [event.type, event.metadata]), [
    ['PRODUCT_VIEWED', { productId: 'catalog' }], ['PRODUCT_VIEWED', { productId: 'cart' }],
  ])
  await f.api.flushAnalytics()
})

test('las visitas de Cart alimentan Recently Viewed real con recencia, máximo diez IDs y persistencia aislada', async t => {
  const f = await flow(t)
  for (const id of ['p1', 'p2', 'p1', ...Array.from({ length: 10 }, (_, index) => 'p' + (index + 3))]) {
    f.open(id); f.close()
  }
  const expected = Array.from({ length: 10 }, (_, index) => 'p' + (12 - index))
  assert.deepEqual(f.api.getRecentlyViewedProductIds('u'), expected)
  assert.equal(f.api.getAnalyticsCounters('u').productViews, 13)
  assert.deepEqual(f.api.getRecentlyViewedProductIds('other'), [])
  const { default: History } = await f.load('components/catalog/RecentlyViewedProducts')
  const props = { userId: 'u', branchId: 'san_jose', onProductSelect: f.openHandler() }
  const draw = () => f.renderComponent('history', History, props)
  draw()
  await f.api.flushAnalytics(); await tick()
  const cards = nodes(draw()).filter(node => node.type === 'button' && label(node).trim().startsWith('Producto '))
  assert.deepEqual(cards.map(node => label(node).trim().split(' ')[1]), expected)
  assert.deepEqual(f.requests.at(-1), { ids: expected, userId: 'u' })
  const { api: reloaded } = await loadAnalytics()
  assert.deepEqual(reloaded.getRecentlyViewedProductIds('u'), expected)
  assert.equal(reloaded.getAnalyticsCounters('u').productViews, 13)
})

test('los botones de imagen y nombre del CartSection real abren el producto actual sin doble registro', async t => {
  const f = await flow(t, { id: 'u', role: 'B2C' }, true)
  const section = () => nodes(f.tree).find(node => node.type?.name === 'CartSection')
  const draw = () => {
    const node = section()
    return f.renderComponent('cart-section', node.type, node.props)
  }
  draw(); await tick()
  let tree = draw()
  nodes(tree).find(node => node.type === 'button' && node.props['aria-label'] === 'Ver detalles de Producto p1').props.onClick()
  f.render(); f.drawQuick()
  assert.equal(f.api.getAnalyticsCounters('u').productViews, 1)
  assert.equal(quickView(f.tree).props.product.id, 'p1')
  f.close()
  tree = draw()
  const heading = nodes(tree).find(node => node.type === 'h3')
  nodes(heading).find(node => node.type === 'button').props.onClick()
  f.render(); f.drawQuick()
  assert.deepEqual(f.api.getAnalyticsEvents('u').map(event => event.metadata.productId), ['p1', 'p1'])
  await f.api.flushAnalytics()
})
