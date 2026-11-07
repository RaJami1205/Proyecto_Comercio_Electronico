/** Core real, storage y locks aislados; no servicios externos ni acumulado persistido adicional. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { analyticsEnvironment, loadAnalytics, event } from './helpers/analyticsHarness.mjs'

const key = id => 'cibernova:analytics:v2:' + (id === null ? 'anonymous' : 'user:' + encodeURIComponent(id))
const empty = id => ({ schemaVersion: 2, userId: id, events: [],
  counters: { sessions: 0, searches: 0, productViews: 0, cartAdds: 0, checkouts: 0, purchases: 0 },
  recentProductIds: [], completedOrderIds: [] })
function snapshot(api) {
  const result = api.getAggregateAnalyticsSnapshot()
  assert.equal(result.status, 'ready')
  return result
}

test('Anonymous, B2C, B2B y ADMIN contribuyen; dos Orders B2C se deduplican entre scopes', async t => {
  const { stored } = analyticsEnvironment(t)
  const { api } = await loadAnalytics()
  const scopes = [null, 'cliente-futuro', 'empresa-futura', 'admin-futuro']
  for (const [index, id] of scopes.entries()) {
    if (id !== null) api.trackEvent(event('SESSION_STARTED', { role: ['B2C', 'B2B', 'ADMIN'][index - 1] }), id)
    for (let n = 0; n <= index; n++) {
      api.trackEvent(event('PRODUCT_VIEWED', { productId: 'p' }), id)
      api.trackEvent(event('SEARCH_PERFORMED', { source: 'catalog' }), id)
      api.trackEvent(event('CART_ITEM_ADDED', { productId: 'p', quantity: 5 }), id)
    }
  }
  for (const orderId of ['order-a', 'order-b', 'order-a']) api.trackEvent(event('PURCHASE_COMPLETED', { orderId }), scopes[1])
  api.trackEvent(event('PURCHASE_COMPLETED', { orderId: 'order-a' }), scopes[3])
  assert.deepEqual(snapshot(api).counters, { productViews: 10, searches: 10, cartAdds: 10, purchases: 2 })
  await api.flushAnalytics()
  const before = [...stored]
  const { api: reload } = await loadAnalytics()
  assert.deepEqual(snapshot(reload).counters, { productViews: 10, searches: 10, cartAdds: 10, purchases: 2 })
  assert.deepEqual([...stored], before, 'selector de lectura sin nueva key ni migración por lectura')
  assert.equal(reload.getAnalyticsCounters(scopes[3]).purchases, 1, 'el selector individual conserva su contrato')
})

test('Descubre IDs nuevos codificados, mantiene Anonymous independiente y rechaza aliases', async t => {
  const { stored } = analyticsEnvironment(t)
  const { api } = await loadAnalytics()
  api.trackEvent(event('PRODUCT_VIEWED', { productId: 'p' }), null)
  api.trackEvent(event('PRODUCT_VIEWED', { productId: 'p' }), 'anonymous')
  api.trackEvent(event('PRODUCT_VIEWED', { productId: 'p' }), 'nuevo / ñ : 用户')
  await api.flushAnalytics()
  stored.set('other-app:analytics', JSON.stringify(empty('other')))
  stored.set('cibernova:analytics:v2:user:%61nonymous', JSON.stringify(empty('anonymous')))
  stored.set('cibernova:analytics:v2:user:%ZZ', '{}')
  const result = snapshot(api)
  assert.equal(result.counters.productViews, 3)
  assert.equal(result.persistence.excludedScopes, 2)
  assert.equal(api.isAnalyticsStorageKey(key('nuevo / ñ : 用户')), true)
  assert.equal(api.isAnalyticsStorageKey('cibernova:analytics:v1:anonymous'), true)
  assert.equal(api.isAnalyticsStorageKey('other-app:analytics'), false)
})

test('Migración v1/v2 usa un snapshot por scope y no escribe durante la consulta', async t => {
  const { stored } = analyticsEnvironment(t)
  const { api } = await loadAnalytics()
  const legacy = empty('legacy')
  delete legacy.schemaVersion; delete legacy.userId
  legacy.counters.searches = 7
  const legacyKey = api.analyticsStorage.legacyKeyPrefix + 'user:legacy'
  stored.set(legacyKey, JSON.stringify(legacy))
  assert.equal(snapshot(api).counters.searches, 7)
  assert.equal(stored.has(key('legacy')), false)
  api.trackEvent(event('SEARCH_PERFORMED', { source: 'recent' }), 'legacy')
  await api.flushAnalytics()
  assert.equal(snapshot(api).counters.searches, 8)
  assert.equal(stored.has(legacyKey), true)
  assert.equal(stored.has(key('legacy')), true)
})

const invalid = [
  ['JSON corrupto', () => '{'],
  ['versión', value => { value.schemaVersion = 99; return JSON.stringify(value) }],
  ['userId', value => { value.userId = 'different'; return JSON.stringify(value) }],
  ['Order IDs', value => { value.counters.purchases = 1; return JSON.stringify(value) }],
  ['contador negativo', value => { value.counters.searches = -1; return JSON.stringify(value) }],
  ['contador inseguro', value => { value.counters.productViews = Number.MAX_SAFE_INTEGER + 1; return JSON.stringify(value) }],
]
for (const [name, serialize] of invalid) test('Excluye ' + name + ' sin rescatar v1 ni bloquear otros scopes', async t => {
  const { stored } = analyticsEnvironment(t)
  const { api } = await loadAnalytics()
  const good = empty('valid'); good.counters.productViews = 2
  stored.set(key('valid'), JSON.stringify(good))
  const raw = serialize(empty('invalid'))
  stored.set(key('invalid'), raw)
  const legacy = empty('invalid'); delete legacy.schemaVersion; delete legacy.userId; legacy.counters.productViews = 100
  stored.set(api.analyticsStorage.legacyKeyPrefix + 'user:invalid', JSON.stringify(legacy))
  const result = snapshot(api)
  assert.equal(result.counters.productViews, 2)
  assert.equal(result.persistence.excludedScopes, 1)
  assert.equal(stored.get(key('invalid')), raw)
})

test('Suma fuera de Number.isSafeInteger produce error sin cifras engañosas', async t => {
  const { stored } = analyticsEnvironment(t)
  const { api } = await loadAnalytics()
  for (const [id, count] of [['large', Number.MAX_SAFE_INTEGER], ['extra', 1]]) {
    const value = empty(id); value.counters.productViews = count; stored.set(key(id), JSON.stringify(value))
  }
  assert.deepEqual(api.getAggregateAnalyticsSnapshot(), { status: 'error' })
})

test('Buffer pendiente y snapshot persistido se reconcilian una sola vez bajo Web Locks', async t => {
  analyticsEnvironment(t)
  const { api } = await loadAnalytics()
  api.trackEvent(event('PRODUCT_VIEWED', { productId: 'p' }), 'u')
  await api.flushAnalytics()
  const request = navigator.locks.request.bind(navigator.locks)
  let release
  navigator.locks.request = (...args) => new Promise(resolve => { release = () => resolve(request(...args)) })
  api.trackEvent(event('PRODUCT_VIEWED', { productId: 'p' }), 'u')
  for (let n = 0; n < 3; n++) {
    const result = snapshot(api)
    assert.equal(result.counters.productViews, 2)
    assert.equal(result.persistence.pending, true)
    assert.equal(result.persistence.memoryOnly, false)
  }
  await Promise.resolve(); release(); await api.flushAnalytics()
  assert.equal(snapshot(api).counters.productViews, 2)
  assert.equal(snapshot(api).persistence.pending, false)
})

test('Scope nuevo In-Memory se incluye tras quota y recupera persistencia', async t => {
  const { storage, stored } = analyticsEnvironment(t)
  const { api } = await loadAnalytics()
  const set = storage.setItem
  storage.setItem = () => { throw new Error('QuotaExceededError') }
  api.trackEvent(event('PRODUCT_VIEWED', { productId: 'p' }), 'new-memory-user')
  await api.flushAnalytics()
  assert.equal(stored.size, 0)
  assert.equal(snapshot(api).counters.productViews, 1)
  assert.equal(snapshot(api).persistence.memoryOnly, true)
  const { api: reload } = await loadAnalytics()
  assert.equal(snapshot(reload).counters.productViews, 0, 'otra instancia no puede leer memoria no sincronizada')
  storage.setItem = set
  api.trackEvent(event('CART_ITEM_ADDED', { productId: 'p', quantity: 4 }), 'new-memory-user')
  await api.flushAnalytics()
  assert.equal(snapshot(api).persistence.memoryOnly, false)
  assert.deepEqual(snapshot(reload).counters, { productViews: 1, searches: 0, cartAdds: 1, purchases: 0 })
})

test('Storage inaccesible conserva el caché válido y comunica un agregado parcial', async t => {
  const { storage } = analyticsEnvironment(t)
  const { api } = await loadAnalytics()
  api.trackEvent(event('SEARCH_PERFORMED', { source: 'catalog' }), 'u')
  await api.flushAnalytics()
  const get = storage.getItem, length = Object.getOwnPropertyDescriptor(storage, 'length')
  storage.getItem = () => { throw new Error('blocked') }
  Object.defineProperty(storage, 'length', { configurable: true, get() { throw new Error('blocked') } })
  assert.equal(snapshot(api).counters.searches, 1)
  assert.equal(snapshot(api).persistence.unavailable, true)
  assert.equal(snapshot(api).persistence.memoryOnly, true)
  storage.getItem = get; Object.defineProperty(storage, 'length', length)
  assert.equal(snapshot(api).persistence.unavailable, false)
})

test('Más de 500 eventos y storage.clear no resucitan acumulados borrados desde caché', async t => {
  const { stored } = analyticsEnvironment(t)
  const { api } = await loadAnalytics()
  api.trackEvent(event('PURCHASE_COMPLETED', { orderId: 'o' }), 'u')
  for (let n = 0; n < 505; n++) api.trackEvent(event('PRODUCT_VIEWED', { productId: 'p' }), 'u')
  await api.flushAnalytics()
  assert.equal(api.getAnalyticsEvents('u').length, 500)
  assert.equal(snapshot(api).counters.productViews, 505)
  assert.equal(snapshot(api).counters.purchases, 1)
  stored.clear()
  assert.deepEqual(snapshot(api).counters, { productViews: 0, searches: 0, cartAdds: 0, purchases: 0 })
})
