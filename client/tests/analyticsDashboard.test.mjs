/** CN-74: Analytics Dashboard con Analytics Core real, storage/locks simulados y hooks de prueba; no usa servicios productivos. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { analyticsEnvironment, loadAnalytics, dataUrl, event } from './helpers/analyticsHarness.mjs'
import { reactHarness, nodes, label } from './helpers/reactHarness.mjs'

const KEY = user => 'cibernova:analytics:v2:user:' + encodeURIComponent(user)
const tick = () => new Promise(resolve => queueMicrotask(resolve))

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
  h.runtime.setUser({ id: 'u', displayName: 'Administrador', role: 'ADMIN' })
  h.runtime.setCart({ items: [], totalUnits: 0, hasExternalConflict: false })
  const { default: Page } = await h.load('pages/AnalyticsDashboardPage')
  const props = { onCatalogClick() {}, onPolicyNavigate() {}, onCartClick() {} }
  let owner
  const view = (pageProps = props) => {
    const boundary = h.render('dashboard-boundary', Page, pageProps)
    if (!boundary || owner !== boundary.key) h.runtime.unmount('dashboard')
    owner = boundary?.key
    return boundary ? h.render('dashboard', boundary.type, boundary.props) : null
  }
  return { ...h, ...storageEnv, events, api: loaded.api, view, Page }
}

/** Valores mostrados por cada MetricCard, tomados de sus props reales. */
function metrics(tree) {
  return Object.fromEntries(nodes(tree).filter(node => typeof node.type === 'function' && node.type.name === 'MetricCard')
    .map(node => [node.props.id.replace('metric-', ''), node.props.value]))
}
const zero = { productViews: 0, searches: 0, cartAdditions: 0, completedPurchases: 0 }

const admin = { id: 'u', displayName: 'Admin', role: 'ADMIN' }
const deniedUsers = [null, { id: 'c', displayName: 'Cliente', role: 'B2C' },
  { id: 'b', displayName: 'Empresa', role: 'B2B', company: { id: 'co', name: 'Empresa local' } }]

/** App, Header y Dashboard reales; se aíslan únicamente vistas comerciales y APIs ajenas al fix. */
async function setupApp(t, user = admin) {
  const h = await setup(t)
  h.runtime.setUser(user)
  for (const name of ['ProductListingPage', 'CartPage', 'CheckoutPage', 'PolicyPlaceholderPage', 'TermsPage', 'ReturnsPolicyPage', 'FaqPage']) {
    h.overrides.set('pages/' + name, dataUrl(`export default '${name}'`))
  }
  for (const name of ['ShippingPolicyPage', 'PrivacyPolicyPage']) h.overrides.set('pages/' + name, dataUrl(`export const ${name} = '${name}'`))
  h.overrides.set('components/cart/CartPreviewDrawer', dataUrl('export default "CartPreviewDrawer"'))
  h.overrides.set('components/session/LoginDialog', dataUrl('export default "LoginDialog"'))
  const history = []
  window.location = new URL('https://local.test/app?qa=1#analytics')
  window.history = Object.fromEntries(['pushState', 'replaceState'].map(method => [method, (_state, _title, next) => {
    history.push({ method, next }); window.location = new URL(next, window.location)
  }]))
  const previousRaf = globalThis.requestAnimationFrame, previousCancel = globalThis.cancelAnimationFrame
  globalThis.requestAnimationFrame = () => 1; globalThis.cancelAnimationFrame = () => {}
  t.after(() => { globalThis.requestAnimationFrame = previousRaf; globalThis.cancelAnimationFrame = previousCancel })
  const { default: App } = await h.load('App')
  const { default: Header } = await h.load('components/layout/Header')
  const appView = () => {
    const tree = h.render('app', App)
    const page = nodes(tree).find(node => node.type === h.Page)
    if (!page) h.runtime.unmount('dashboard')
    return { tree, page, content: page ? h.view(page.props) : null }
  }
  return { ...h, history, appView, header: props => h.render('header', Header, props) }
}

for (const user of [...deniedUsers, admin]) test('ADMIN-only en Header, ruta directa y Dashboard: ' + (user?.role ?? 'null'), async t => {
  const h = await setupApp(t, user)
  const allowed = user?.role === 'ADMIN'
  for (const props of [{}, { cartView: true }, { policyView: true }, { analyticsView: true }]) {
    const header = h.header(props)
    const links = nodes(header).filter(node => node.type === 'a' && node.props.href === '#analytics')
    assert.equal(links.length, allowed ? 1 : 0)
    assert.equal(nodes(header).some(node => node.type === 'li' && node.props.children == null), false)
  }
  let reads = 0
  const read = h.storage.getItem
  h.storage.getItem = key => { if (key.startsWith('cibernova:analytics:')) reads++; return read(key) }
  h.appView()
  const result = h.appView()
  assert.equal(Boolean(result.page), allowed)
  assert.deepEqual(metrics(result.content), allowed ? zero : {})
  assert.equal(window.location.hash, allowed ? '#analytics' : '#catalog')
  assert.equal(h.events.count('cibernova:analytics-changed'), allowed ? 1 : 0)
  assert.equal(h.events.count('storage'), allowed ? 1 : 0)
  if (!allowed) {
    assert.equal(reads, 0, 'no se consulta Analytics para un usuario no autorizado')
    assert.equal(h.view(), null, 'el límite de la página también deniega el montaje independiente')
    assert.deepEqual(h.history.map(entry => entry.method), ['replaceState'])
    h.appView()
    assert.equal(h.history.length, 1, 'no se generan redirects repetidos')
  }
})

for (const user of deniedUsers) test('Route Guard bloquea hashchange, Back/Forward y navegación interna: ' + (user?.role ?? 'null'), async t => {
  const h = await setupApp(t, user)
  h.appView()
  for (const type of ['hashchange', 'popstate', 'popstate']) {
    window.location = new URL('#analytics', window.location)
    h.events.emit(type, {})
    assert.equal(h.appView().page, undefined)
    assert.equal(window.location.hash, '#catalog')
  }
  const catalog = nodes(h.appView().tree).find(node => node.type === 'ProductListingPage')
  catalog.props.onPolicyNavigate('analytics')
  assert.equal(h.appView().page, undefined)
  assert.equal(window.location.hash, '#catalog')
  assert.equal(h.history.some(entry => entry.method === 'pushState'), false)
})

for (const user of deniedUsers) test('ADMIN → ' + (user?.role ?? 'Logout') + ' desmonta métricas y descarta IO tardío', async t => {
  const h = await setupApp(t)
  h.appView(); h.appView()
  const request = navigator.locks.request.bind(navigator.locks)
  let release
  navigator.locks.request = (...args) => new Promise(resolve => { release = () => resolve(request(...args)) })
  h.api.trackEvent(event('PRODUCT_VIEWED', { productId: 'p' }), 'u')
  await Promise.resolve()
  assert.equal(metrics(h.appView().content).productViews, 1)
  h.runtime.setUser(user)
  const revoked = h.appView()
  assert.equal(revoked.page, undefined)
  assert.equal(revoked.content, null)
  assert.equal(window.location.hash, '#catalog')
  assert.equal(h.events.count('cibernova:analytics-changed'), 0)
  assert.equal(h.events.count('storage'), 0)
  release()
  await h.api.flushAnalytics()
  h.events.emit('storage', { key: KEY('u') })
  assert.equal(h.appView().page, undefined, 'el IO anterior no restaura contenido protegido')
  assert.equal(h.view(), null)
})

test('Remount de contenido ADMIN limpia listeners y no duplica la suscripción', async t => {
  const h = await setupApp(t)
  h.appView(); h.appView()
  h.runtime.unmount('dashboard')
  assert.equal(h.events.count('storage'), 0)
  h.appView(); h.appView()
  assert.equal(h.events.count('storage'), 1)
  assert.equal(h.events.count('cibernova:analytics-changed'), 1)
  h.runtime.setUser(null)
  h.appView()
  assert.equal(h.events.count('storage'), 0)
})

test('IO pendiente bajo Web Locks no muestra un warning falso y notifica el commit', async t => {
  const h = await setup(t)
  h.view()
  const request = navigator.locks.request.bind(navigator.locks)
  let release
  navigator.locks.request = (...args) => new Promise(resolve => { release = () => resolve(request(...args)) })
  h.api.trackEvent(event('SEARCH_PERFORMED', { source: 'catalog' }), 'u')
  assert.equal(h.api.getAnalyticsStorageStatus('u'), 'pending')
  await tick()
  assert.equal(metrics(h.view()).searches, 1)
  assert.doesNotMatch(label(h.view()), /puede perderse al recargar/)
  await Promise.resolve()
  release()
  await h.api.flushAnalytics()
  assert.equal(h.api.getAnalyticsStorageStatus('u'), 'persistent')
  assert.equal(JSON.parse(h.stored.get(KEY('u'))).counters.searches, 1)
})

for (const failure of ['QuotaExceededError', 'write-only']) test('Persistence Status detecta ' + failure + ', conserva memoria y recupera tras commit', async t => {
  const h = await setup(t)
  h.view()
  h.api.trackEvent(event('SEARCH_PERFORMED', { source: 'catalog' }), 'u')
  await h.api.flushAnalytics()
  const set = h.storage.setItem
  h.storage.setItem = () => { const error = new Error('escritura rechazada'); error.name = failure; throw error }
  h.api.trackEvent(event('SEARCH_PERFORMED', { source: 'recent' }), 'u')
  assert.doesNotMatch(label(h.view()), /puede perderse al recargar/, 'el write pendiente todavía no falló')
  await h.api.flushAnalytics()
  assert.equal(h.api.getAnalyticsStorageStatus('u'), 'memory-only')
  assert.equal(metrics(h.view()).searches, 2)
  assert.match(label(h.view()), /puede perderse al recargar/)
  assert.equal(JSON.parse(h.storage.getItem(KEY('u'))).counters.searches, 1, 'la lectura sigue disponible')
  const { api: reloaded } = await loadAnalytics()
  assert.equal(reloaded.getAnalyticsCounters('u').searches, 1, 'Reload pierde el evento no persistido')
  h.storage.setItem = set
  h.api.trackEvent(event('PRODUCT_VIEWED', { productId: 'p' }), 'u')
  assert.equal(h.api.getAnalyticsStorageStatus('u'), 'memory-only', 'no declarar recuperación antes del commit')
  await h.api.flushAnalytics()
  assert.equal(h.api.getAnalyticsStorageStatus('u'), 'persistent')
  assert.doesNotMatch(label(h.view()), /puede perderse al recargar/)
  assert.deepEqual(metrics(h.view()), { ...zero, searches: 2, productViews: 1 })
  const raw = JSON.parse(h.stored.get(KEY('u')))
  assert.equal(raw.schemaVersion, 2)
  assert.equal(raw.counters.searches, 2)
})

test('Persistence Status de un fallo permanece aislado al scope correspondiente', async t => {
  const h = await setup(t)
  const set = h.storage.setItem
  h.storage.setItem = (key, value) => { if (key === KEY('u')) throw new Error('quota'); return set(key, value) }
  h.api.trackEvent(event('PRODUCT_VIEWED', { productId: 'p' }), 'u')
  h.api.trackEvent(event('PRODUCT_VIEWED', { productId: 'p' }), 'other')
  await h.api.flushAnalytics()
  assert.equal(h.api.getAnalyticsStorageStatus('u'), 'memory-only')
  assert.equal(h.api.getAnalyticsStorageStatus('other'), 'persistent')
})

test('Web Lock rechazado informa memoria y una escritura posterior recupera persistencia', async t => {
  const h = await setup(t)
  h.view()
  const request = navigator.locks.request
  navigator.locks.request = () => Promise.reject(new Error('lock rechazado'))
  h.api.trackEvent(event('SEARCH_PERFORMED', { source: 'catalog' }), 'u')
  await h.api.flushAnalytics()
  assert.match(label(h.view()), /puede perderse al recargar/)
  navigator.locks.request = request
  h.api.trackEvent(event('SEARCH_PERFORMED', { source: 'recent' }), 'u')
  await h.api.flushAnalytics()
  assert.equal(h.api.getAnalyticsStorageStatus('u'), 'persistent')
  assert.equal(metrics(h.view()).searches, 2)
})

test('Dashboard preserva acumulados >500, schema v2 y compra deduplicada tras Reload', async t => {
  const h = await setup(t)
  h.api.trackEvent(event('PURCHASE_COMPLETED', { orderId: 'o' }), 'u')
  for (let i = 0; i < 505; i++) h.api.trackEvent(event('PRODUCT_VIEWED', { productId: 'p' }), 'u')
  await h.api.flushAnalytics()
  h.view()
  assert.equal(metrics(h.view()).productViews, 505)
  assert.equal(h.api.getAnalyticsEvents('u').length, 500)
  const { api: reloaded } = await loadAnalytics()
  reloaded.trackEvent(event('PURCHASE_COMPLETED', { orderId: 'o' }), 'u')
  assert.equal(reloaded.getAnalyticsCounters('u').purchases, 1)
  assert.equal(reloaded.getAnalyticsCounters('u').productViews, 505)
  assert.equal(JSON.parse(h.stored.get(KEY('u'))).schemaVersion, 2)
})

test('Dashboard presenta ceros, Empty State y alcance agregado cuando no hay actividad', async t => {
  const h = await setup(t)
  assert.match(label(h.view()), /Cargando/, 'primer render antes de leer Analytics Core')
  const tree = h.view()
  assert.deepEqual(metrics(tree), zero)
  assert.match(label(tree), /Todavía no hay actividad/)
  assert.match(label(tree), /Estadísticas agregadas de usuarios y visitantes de este navegador/)
  assert.match(label(tree), /No son estadísticas globales/)
  assert.ok(nodes(tree).find(node => node.type === 'h1' && node.props['data-app-heading']))
})

test('Dashboard ADMIN agrega Anonymous, B2C, B2B y ADMIN sin depender de la identidad activa', async t => {
  const h = await setup(t)
  h.view()
  for (const id of [null, 'cliente', 'empresa', 'otro-admin']) {
    h.api.trackEvent(event('PRODUCT_VIEWED', { productId: 'p' }), id)
    h.api.trackEvent(event('SEARCH_PERFORMED', { source: 'catalog' }), id)
  }
  h.api.trackEvent(event('CART_ITEM_ADDED', { productId: 'p', quantity: 5 }), 'cliente')
  for (const orderId of ['o1', 'o2', 'o1']) h.api.trackEvent(event('PURCHASE_COMPLETED', { orderId }), 'cliente')
  h.api.trackEvent(event('PURCHASE_COMPLETED', { orderId: 'o1' }), 'otro-admin')
  await h.api.flushAnalytics()
  assert.deepEqual(metrics(h.view()), { productViews: 4, searches: 4, cartAdditions: 1, completedPurchases: 2 })
  assert.equal(h.api.getAnalyticsCounters('u').purchases, 0)
  h.runtime.setUser({ id: 'new-admin', displayName: 'Nuevo ADMIN', role: 'ADMIN' })
  h.view()
  assert.equal(metrics(h.view()).completedPurchases, 2)
  assert.match(label(h.view()), /Estadísticas agregadas/)
})

test('Ráfagas agrupan lecturas y una actualización encolada no restaura métricas tras Logout', async t => {
  const h = await setup(t)
  h.api.trackEvent(event('PRODUCT_VIEWED', { productId: 'p' }), 'u')
  await h.api.flushAnalytics()
  h.view(); h.view()
  let reads = 0
  const get = h.storage.getItem
  h.storage.getItem = key => { reads++; return get(key) }
  for (let n = 0; n < 20; n++) h.events.emit('storage', { key: KEY('new-user') })
  assert.equal(reads, 0, 'no releer por cada notificación de la ráfaga')
  await tick()
  const firstRefresh = reads
  assert.ok(firstRefresh > 0)
  h.events.emit('storage', { key: KEY('new-user') })
  await tick()
  assert.equal(reads, firstRefresh * 2)
  h.events.emit('storage', { key: KEY('new-user') })
  h.runtime.setUser(null)
  assert.equal(h.view(), null)
  await tick()
  assert.equal(reads, firstRefresh * 2, 'cleanup cancela el refresh encolado')
  assert.equal(h.events.count('storage'), 0)
})

test('Product Views, Searches, Cart Additions y Completed Purchases se actualizan reactivamente desde Analytics Core', async t => {
  const h = await setup(t)
  h.view()
  h.api.trackEvent(event('PRODUCT_VIEWED', { productId: 'p1' }), 'u')
  await tick()
  assert.equal(metrics(h.view()).productViews, 1)
  h.api.trackEvent(event('PRODUCT_VIEWED', { productId: 'p1' }), 'u')
  await tick()
  assert.equal(metrics(h.view()).productViews, 2, 'cada apertura real es una interacción independiente')
  h.api.trackEvent(event('SEARCH_PERFORMED', { source: 'catalog' }), 'u')
  await tick()
  assert.equal(metrics(h.view()).searches, 1)
  h.api.trackEvent(event('CART_ITEM_ADDED', { productId: 'p1', quantity: 5 }), 'u')
  await tick()
  assert.equal(metrics(h.view()).cartAdditions, 1, 'una acción de cinco unidades es una sola adición')
  h.api.trackEvent(event('PURCHASE_COMPLETED', { orderId: 'o-1' }), 'u')
  await tick()
  const tree = h.view()
  assert.deepEqual(metrics(tree), { productViews: 2, searches: 1, cartAdditions: 1, completedPurchases: 1 })
  assert.doesNotMatch(label(tree), /Todavía no hay actividad/)
  await h.api.flushAnalytics()
})

test('Completed Purchases deduplica por Order ID y no cuenta Checkout iniciado (Orders pendientes)', async t => {
  const h = await setup(t)
  h.api.trackEvent(event('CHECKOUT_STARTED'), 'u')
  h.view()
  assert.equal(metrics(h.view()).completedPurchases, 0)
  h.api.trackEvent(event('PURCHASE_COMPLETED', { orderId: 'o-1' }), 'u')
  h.api.trackEvent(event('PURCHASE_COMPLETED', { orderId: 'o-1' }), 'u')
  await tick()
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

test('Cambiar entre ADMIN conserva el agregado y renueva la suscripción autorizada', async t => {
  const h = await setup(t)
  h.runtime.setUser({ id: 'a', displayName: 'A', role: 'ADMIN' })
  h.api.trackEvent(event('SEARCH_PERFORMED', { source: 'catalog' }), 'a')
  h.view()
  assert.equal(metrics(h.view()).searches, 1)
  h.runtime.setUser({ id: 'b', displayName: 'B', role: 'ADMIN' })
  const transition = h.view()
  assert.deepEqual(metrics(transition), {}, 'no se muestran valores de A mientras se carga B')
  assert.match(label(transition), /Cargando/)
  assert.deepEqual(metrics(h.view()), { ...zero, searches: 1 })
  h.runtime.setUser({ id: 'a', displayName: 'A', role: 'ADMIN' })
  h.view()
  assert.equal(metrics(h.view()).searches, 1, 'A recupera sus métricas al volver a seleccionarse')
  assert.equal(h.events.count('cibernova:analytics-changed'), 1, 'el listener anterior se limpia')
  await h.api.flushAnalytics()
})

test('Sin usuario activo no se monta contenido ni se atribuye la actividad anónima', async t => {
  const h = await setup(t)
  h.api.trackEvent(event('PRODUCT_VIEWED', { productId: 'p1' }))
  h.runtime.setUser(null)
  const tree = h.view()
  assert.deepEqual(metrics(tree), {})
  assert.equal(tree, null)
  assert.equal(h.events.count('cibernova:analytics-changed'), 0)
  await h.api.flushAnalytics()
})

test('Storage de otra pestaña incluye cualquier scope nuevo y omite claves ajenas', async t => {
  const h = await setup(t)
  h.view()
  const other = await loadAnalytics()
  const observers = [...h.listeners]
  h.listeners.clear() // La otra pestaña no publica su changedEvent en esta ventana.
  other.api.trackEvent(event('CART_ITEM_ADDED', { productId: 'p', quantity: 1 }), 'new-b2c')
  await other.api.flushAnalytics()
  observers.forEach(observer => h.listeners.add(observer))
  h.events.emit('storage', { key: 'unrelated:key' })
  await tick()
  assert.equal(metrics(h.view()).cartAdditions, 0)
  h.events.emit('storage', { key: KEY('new-b2c') })
  await tick()
  assert.equal(metrics(h.view()).cartAdditions, 1)
  h.listeners.clear()
  other.api.trackEvent(event('SEARCH_PERFORMED', { source: 'catalog' }), null)
  other.api.trackEvent(event('SEARCH_PERFORMED', { source: 'catalog' }), 'new-b2b')
  await other.api.flushAnalytics()
  observers.forEach(observer => h.listeners.add(observer))
  h.events.emit('storage', { key: other.api.analyticsStorage.keyPrefix + 'anonymous' })
  h.events.emit('storage', { key: KEY('new-b2b') })
  await tick()
  assert.equal(metrics(h.view()).searches, 2)
  h.stored.clear()
  h.events.emit('storage', { key: null })
  await tick()
  assert.deepEqual(metrics(h.view()), zero)
})

for (const [name, raw] of [['corrupto', '{no-json'], ['versión incompatible', JSON.stringify({ schemaVersion: 99, userId: 'u' })]]) {
  test('Analytics Storage ' + name + ' se informa, se conserva intacto y no muestra datos ficticios', async t => {
    const h = await setup(t)
    h.stored.set(KEY('u'), raw)
    h.view()
    const tree = h.view()
    assert.deepEqual(metrics(tree), zero)
    assert.match(label(tree), /datos dañados, incompatibles/)
    h.api.trackEvent(event('PRODUCT_VIEWED', { productId: 'p1' }), 'u')
    await tick()
    assert.equal(metrics(h.view()).productViews, 1)
    await h.api.flushAnalytics()
    assert.equal(h.stored.get(KEY('u')), raw)
  })
}

test('localStorage no disponible: Dashboard funciona en memoria y lo indica', async t => {
  const h = await setup(t)
  Object.defineProperty(window, 'localStorage', { configurable: true, get() { throw new Error('SecurityError') } })
  h.view()
  let tree = h.view()
  assert.match(label(tree), /puede perderse al recargar/)
  h.api.trackEvent(event('SEARCH_PERFORMED', { source: 'catalog' }), 'u')
  await tick()
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
    export function getAggregateAnalyticsSnapshot(){ if(globalThis.__dashboardFail()) throw new Error('boom'); return {status:'ready',counters:{searches:3,productViews:0,cartAdds:0,purchases:0},persistence:{pending:false,memoryOnly:false,unavailable:false,excludedScopes:0}}; }
    export function isAnalyticsStorageKey(){return true;}
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
  h.runtime.setUser({ id: 'u', displayName: 'Admin', role: 'ADMIN' })
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
