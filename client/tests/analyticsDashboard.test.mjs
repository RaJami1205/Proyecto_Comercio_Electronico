/** CN-74: Analytics Dashboard con Analytics Core real, storage/locks simulados y hooks de prueba; no usa servicios productivos. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { analyticsEnvironment, loadAnalytics, dataUrl, event } from './helpers/analyticsHarness.mjs'
import { reactHarness, nodes, label } from './helpers/reactHarness.mjs'

const KEY = user => 'cibernova:analytics:v2:user:' + encodeURIComponent(user)

/** Conecta addEventListener con el dispatchEvent del harness de Analytics. */
function wireListeners(env) {
  const byType = new Map()
  window.addEventListener = (type, callback) => { if (!byType.has(type)) byType.set(type, new Set()); byType.get(type).add(callback) }
  window.removeEventListener = (type, callback) => byType.get(type)?.delete(callback)
  env.listeners.add(dispatched => byType.get(dispatched.type)?.forEach(callback => callback(dispatched)))
  return { emit: (type, payload) => byType.get(type)?.forEach(callback => callback(payload)), count: type => byType.get(type)?.size ?? 0 }
}

async function setup(t, { env, analyticsUrl } = {}) {
  const h = await reactHarness()
  // Si el entorno se creó antes, su restauración corre primero: los cleanups no deben tocar un window ausente.
  t.after(() => { if (globalThis.window) h.runtime.dispose() })
  const storageEnv = env ?? analyticsEnvironment(t)
  const events = env ? null : wireListeners(storageEnv)
  const loaded = analyticsUrl ? { api: await import(analyticsUrl), url: analyticsUrl } : await loadAnalytics()
  h.overrides.set('services/analytics', loaded.url)
  for (const name of ['Header', 'Footer']) h.overrides.set('components/layout/' + name, dataUrl(`export default '${name}'`))
  h.runtime.setUser({ id: 'u', displayName: 'Cliente', role: 'B2C' })
  const { default: Page } = await h.load('pages/AnalyticsDashboardPage')
  const props = { onCatalogClick() {}, onPolicyNavigate() {}, onCartClick() {} }
  const view = () => h.render('dashboard', Page, props)
  return { ...h, ...storageEnv, events, api: loaded.api, view }
}

/** Valores mostrados por cada MetricCard, tomados de sus props reales. */
function metrics(tree) {
  return Object.fromEntries(nodes(tree).filter(node => typeof node.type === 'function' && node.type.name === 'MetricCard')
    .map(node => [node.props.id.replace('metric-', ''), node.props.value]))
}
const zero = { productViews: 0, searches: 0, cartAdditions: 0, completedPurchases: 0 }

test('Dashboard presenta las cuatro métricas en cero, Empty State y alcance local para usuario sin actividad', async t => {
  const h = await setup(t)
  assert.match(label(h.view()), /Cargando/, 'primer render antes de leer Analytics Core')
  const tree = h.view()
  assert.deepEqual(metrics(tree), zero)
  assert.match(label(tree), /Todavía no tienes actividad/)
  assert.match(label(tree), /Datos locales de este navegador/)
  assert.match(label(tree), /No son estadísticas globales/)
  assert.ok(nodes(tree).find(node => node.type === 'h1' && node.props['data-app-heading']))
})

test('Product Views, Searches, Cart Additions y Completed Purchases se actualizan reactivamente desde Analytics Core', async t => {
  const h = await setup(t)
  h.view()
  h.api.trackEvent(event('PRODUCT_VIEWED', { productId: 'p1' }), 'u')
  assert.equal(metrics(h.view()).productViews, 1)
  h.api.trackEvent(event('PRODUCT_VIEWED', { productId: 'p1' }), 'u')
  assert.equal(metrics(h.view()).productViews, 2, 'cada apertura real es una interacción independiente')
  h.api.trackEvent(event('SEARCH_PERFORMED', { source: 'catalog' }), 'u')
  assert.equal(metrics(h.view()).searches, 1)
  h.api.trackEvent(event('CART_ITEM_ADDED', { productId: 'p1', quantity: 5 }), 'u')
  assert.equal(metrics(h.view()).cartAdditions, 1, 'una acción de cinco unidades es una sola adición')
  h.api.trackEvent(event('PURCHASE_COMPLETED', { orderId: 'o-1' }), 'u')
  const tree = h.view()
  assert.deepEqual(metrics(tree), { productViews: 2, searches: 1, cartAdditions: 1, completedPurchases: 1 })
  assert.doesNotMatch(label(tree), /Todavía no tienes actividad/)
  await h.api.flushAnalytics()
})

test('Completed Purchases deduplica por Order ID y no cuenta Checkout iniciado (Orders pendientes)', async t => {
  const h = await setup(t)
  h.api.trackEvent(event('CHECKOUT_STARTED'), 'u')
  h.view()
  assert.equal(metrics(h.view()).completedPurchases, 0)
  h.api.trackEvent(event('PURCHASE_COMPLETED', { orderId: 'o-1' }), 'u')
  h.api.trackEvent(event('PURCHASE_COMPLETED', { orderId: 'o-1' }), 'u')
  assert.equal(metrics(h.view()).completedPurchases, 1, 'Replay del mismo Order ID no incrementa')
  await h.api.flushAnalytics()
})

test('Dashboard no expone emisión: DECLINED/ERROR/pending se excluyen en el emisor (paymentIntegrity) y aquí solo se lee', () => {
  const source = readFileSync(new URL('../src/pages/AnalyticsDashboardPage.tsx', import.meta.url), 'utf8')
    + readFileSync(new URL('../src/hooks/useAnalyticsMetrics.ts', import.meta.url), 'utf8')
  assert.doesNotMatch(source, /trackEvent|localStorage|orderApi|paymentApi|getAnalyticsEvents/)
  const checkout = readFileSync(new URL('../src/pages/CheckoutPage.tsx', import.meta.url), 'utf8')
  assert.match(checkout, /result\.result === 'PAYMENT_APPROVED' && result\.order\.orderStatus === 'CONFIRMED'\s+&& result\.order\.paymentStatus === 'APPROVED'/)
})

test('Métricas acumuladas se recuperan después de recargar', async t => {
  const first = await setup(t)
  first.api.trackEvent(event('PRODUCT_VIEWED', { productId: 'p1' }), 'u')
  first.api.trackEvent(event('PURCHASE_COMPLETED', { orderId: 'o-1' }), 'u')
  await first.api.flushAnalytics()
  assert.ok(first.stored.has(KEY('u')))
  const reloaded = await loadAnalytics()
  const second = await setup(t, { env: first, analyticsUrl: reloaded.url })
  second.view()
  assert.deepEqual(metrics(second.view()), { ...zero, productViews: 1, completedPurchases: 1 })
  assert.equal(nodes(second.view()).some(node => node.props?.role === 'alert'), false)
})

test('Aislamiento entre usuarios y cambio de Session Context invalidan los valores anteriores', async t => {
  const h = await setup(t)
  h.runtime.setUser({ id: 'a', displayName: 'A', role: 'B2C' })
  h.api.trackEvent(event('SEARCH_PERFORMED', { source: 'catalog' }), 'a')
  h.view()
  assert.equal(metrics(h.view()).searches, 1)
  h.runtime.setUser({ id: 'b', displayName: 'B', role: 'B2B' })
  const transition = h.view()
  assert.deepEqual(metrics(transition), {}, 'no se muestran valores de A mientras se carga B')
  assert.match(label(transition), /Cargando/)
  assert.deepEqual(metrics(h.view()), zero)
  h.runtime.setUser({ id: 'a', displayName: 'A', role: 'B2C' })
  h.view()
  assert.equal(metrics(h.view()).searches, 1, 'A recupera sus métricas al volver a seleccionarse')
  assert.equal(h.events.count('cibernova:analytics-changed'), 1, 'el listener anterior se limpia')
  await h.api.flushAnalytics()
})

test('Sin usuario activo se solicita identidad y no se atribuye la actividad anónima', async t => {
  const h = await setup(t)
  h.api.trackEvent(event('PRODUCT_VIEWED', { productId: 'p1' }))
  h.runtime.setUser(null)
  const tree = h.view()
  assert.deepEqual(metrics(tree), {})
  assert.match(label(tree), /Selecciona una identidad/)
  assert.ok(nodes(tree).find(node => node.type === 'button' && /Iniciar sesión/.test(label(node))))
  await h.api.flushAnalytics()
})

test('Storage de otra pestaña del mismo scope refresca el Dashboard; otros scopes se ignoran', async t => {
  const h = await setup(t)
  h.view()
  const other = await loadAnalytics()
  other.api.trackEvent(event('CART_ITEM_ADDED', { productId: 'p', quantity: 1 }), 'u')
  await other.api.flushAnalytics()
  h.events.emit('storage', { key: KEY('someone-else') })
  assert.equal(metrics(h.view()).cartAdditions, 0)
  h.events.emit('storage', { key: KEY('u') })
  assert.equal(metrics(h.view()).cartAdditions, 1)
})

for (const [name, raw] of [['corrupto', '{no-json'], ['versión incompatible', JSON.stringify({ schemaVersion: 99, userId: 'u' })]]) {
  test('Analytics Storage ' + name + ' se informa, se conserva intacto y no muestra datos ficticios', async t => {
    const h = await setup(t)
    h.stored.set(KEY('u'), raw)
    h.view()
    const tree = h.view()
    assert.deepEqual(metrics(tree), zero)
    assert.match(label(tree), /dañados o pertenecen a otra versión/)
    h.api.trackEvent(event('PRODUCT_VIEWED', { productId: 'p1' }), 'u')
    assert.equal(metrics(h.view()).productViews, 1)
    await h.api.flushAnalytics()
    assert.equal(h.stored.get(KEY('u')), raw)
  })
}

test('localStorage no disponible: Dashboard funciona en memoria y lo indica', async t => {
  const h = await setup(t)
  h.storage.getItem = () => { throw new Error('SecurityError') }
  h.storage.setItem = () => { throw new Error('SecurityError') }
  h.view()
  let tree = h.view()
  assert.match(label(tree), /no permite guardar las métricas/)
  h.api.trackEvent(event('SEARCH_PERFORMED', { source: 'catalog' }), 'u')
  tree = h.view()
  assert.equal(metrics(tree).searches, 1)
  await h.api.flushAnalytics()
})

test('Métricas temporalmente no disponibles muestran error con Reintentar sin lanzar', async t => {
  const env = analyticsEnvironment(t)
  wireListeners(env)
  let fail = true
  globalThis.__dashboardFail = () => fail
  t.after(() => delete globalThis.__dashboardFail)
  const stub = dataUrl(`
    export const analyticsStorage={keyPrefix:'cibernova:analytics:v2:',changedEvent:'cibernova:analytics-changed'};
    export function getAnalyticsCounters(){ if(globalThis.__dashboardFail()) throw new Error('boom'); return {sessions:0,searches:3,productViews:0,cartAdds:0,checkouts:0,purchases:0}; }
    export function getAnalyticsStorageStatus(){ return 'persistent'; }
    export function refreshAnalyticsState(){}
  `)
  const h = await setup(t, { env, analyticsUrl: stub })
  h.view()
  let tree = h.view()
  assert.match(label(tree), /no están disponibles/)
  assert.deepEqual(metrics(tree), {})
  fail = false
  nodes(tree).find(node => node.type === 'button' && /Reintentar/.test(label(node))).props.onClick()
  h.view()
  tree = h.view()
  assert.equal(metrics(tree).searches, 3)
})

test('toDashboardMetrics es compatible con AnalyticsCounters de Analytics Core', async t => {
  const h = await reactHarness()
  t.after(() => h.runtime.dispose())
  analyticsEnvironment(t)
  const { url } = await loadAnalytics()
  h.overrides.set('services/analytics', url)
  const { toDashboardMetrics } = await h.load('hooks/useAnalyticsMetrics')
  assert.deepEqual(toDashboardMetrics({ sessions: 9, searches: 2, productViews: 1, cartAdds: 3, checkouts: 8, purchases: 4 }),
    { productViews: 1, searches: 2, cartAdditions: 3, completedPurchases: 4 })
})

test('Navegación: #analytics es un destino de App, funciona con hashchange/Back y en recarga directa', async t => {
  const h = await reactHarness()
  t.after(() => h.runtime.dispose())
  analyticsEnvironment(t)
  const { url } = await loadAnalytics()
  h.overrides.set('services/analytics', url)
  for (const name of ['ProductListingPage', 'CartPage', 'CheckoutPage', 'PolicyPlaceholderPage', 'TermsPage', 'ReturnsPolicyPage', 'FaqPage', 'AnalyticsDashboardPage']) h.overrides.set('pages/' + name, dataUrl(`export default '${name}'`))
  for (const name of ['ShippingPolicyPage', 'PrivacyPolicyPage']) h.overrides.set('pages/' + name, dataUrl(`export const ${name} = '${name}'`))
  h.overrides.set('components/cart/CartPreviewDrawer', dataUrl('export default "CartPreviewDrawer"'))
  h.overrides.set('components/session/LoginDialog', dataUrl('export default "LoginDialog"'))
  h.runtime.setCart({ items: [], hasExternalConflict: false })
  const listeners = new Map()
  window.addEventListener = (type, callback) => listeners.set(type, callback)
  window.removeEventListener = type => listeners.delete(type)
  window.history = { pushState(_s, _u, next) { window.location = new URL(next, window.location) }, replaceState(_s, _u, next) { window.location = new URL(next, window.location) } }
  const previousRaf = globalThis.requestAnimationFrame, previousCancel = globalThis.cancelAnimationFrame
  globalThis.requestAnimationFrame = () => 1; globalThis.cancelAnimationFrame = () => {}
  t.after(() => { globalThis.requestAnimationFrame = previousRaf; globalThis.cancelAnimationFrame = previousCancel })

  const nav = await h.load('utils/appNavigation')
  assert.equal(nav.viewFromHash('#analytics'), 'analytics')
  assert.equal(nav.hashForView('analytics'), '#analytics')

  window.location = new URL('https://local.test/#analytics')
  const { default: App } = await h.load('App')
  let tree = h.render('app', App)
  assert.ok(nodes(tree).some(node => node.type === 'AnalyticsDashboardPage'), 'recarga directa en #analytics')
  window.location = new URL('https://local.test/#catalog')
  listeners.get('popstate')()
  tree = h.render('app', App)
  assert.equal(nodes(tree).some(node => node.type === 'AnalyticsDashboardPage'), false)
  window.location = new URL('https://local.test/#analytics')
  listeners.get('hashchange')()
  tree = h.render('app', App)
  const page = nodes(tree).find(node => node.type === 'AnalyticsDashboardPage')
  assert.ok(page, 'Forward/hashchange vuelve al Dashboard')
  page.props.onCatalogClick('#catalog')
  tree = h.render('app', App)
  assert.equal(window.location.hash, '#catalog')
  assert.equal(nodes(tree).some(node => node.type === 'AnalyticsDashboardPage'), false)
})

test('Responsive: 4 columnas en Desktop, 2 en Tablet y 1 en Mobile; navegación del Header puede envolver', () => {
  const css = readFileSync(new URL('../src/styles/analytics/AnalyticsDashboardPage.module.css', import.meta.url), 'utf8')
  assert.match(css, /\.grid \{[^}]*repeat\(4, minmax\(0, 1fr\)\)/)
  assert.match(css, /@media \(max-width: 960px\) \{\s*\.grid \{ grid-template-columns: repeat\(2, minmax\(0, 1fr\)\); \}/)
  assert.match(css, /@media \(max-width: 520px\) \{\s*\.grid \{ grid-template-columns: minmax\(0, 1fr\); \}/)
  const header = readFileSync(new URL('../src/styles/layout/Header.module.css', import.meta.url), 'utf8')
  assert.match(header, /@media \(max-width: 760px\)[\s\S]*\.navigation ul \{\s*flex-wrap: wrap;/)
})
