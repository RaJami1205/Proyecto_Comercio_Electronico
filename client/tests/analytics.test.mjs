/** Servicio real con storage y Web Locks aislados: no utiliza datos del navegador. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { analyticsEnvironment, loadAnalytics, event } from './helpers/analyticsHarness.mjs'

test('separa scopes por usuario y restaura el envelope desde localStorage', async t => {
  const { stored } = analyticsEnvironment(t)
  const { api } = await loadAnalytics()
  api.trackEvent(event('SESSION_STARTED', { role: 'B2C' }), 'user-a')
  api.trackEvent(event('SEARCH_PERFORMED', { source: 'catalog' }))
  await api.flushAnalytics()
  assert.equal(api.getAnalyticsCounters('user-a').sessions, 1)
  assert.equal(api.getAnalyticsCounters('user-a').searches, 0)
  assert.equal(api.getAnalyticsCounters('user-b').sessions, 0)
  assert.equal(api.getAnalyticsCounters().searches, 1)
  const [saved] = api.getAnalyticsEvents('user-a')
  assert.equal(saved.userId, 'user-a')
  assert.equal(saved.schemaVersion, 2)
  assert.match(saved.eventId, /^[a-f0-9-]{36}$/)
  assert.equal(api.getAnalyticsEvents()[0].userId, null)
  const originalId = saved.eventId
  saved.metadata.role = 'ADMIN'
  assert.equal(api.getAnalyticsEvents('user-a')[0].metadata.role, 'B2C')
  const { api: reload } = await loadAnalytics()
  assert.equal(reload.getAnalyticsEvents('user-a')[0].eventId, originalId)
  assert.equal(reload.getAnalyticsCounters('user-a').sessions, 1)
  assert.ok([...stored.keys()].some(key => key.endsWith('user:user-a')))
})

test('registra vistas como acciones y mantiene IDs recientes únicos y limitados', async t => {
  analyticsEnvironment(t)
  const { api } = await loadAnalytics()
  for (const productId of ['p1', 'p2', 'p1', 'p3']) api.trackEvent(event('PRODUCT_VIEWED', { productId }), 'history-user')
  assert.deepEqual(api.getRecentlyViewedProductIds('history-user'), ['p3', 'p1', 'p2'])
  assert.equal(api.getAnalyticsCounters('history-user').productViews, 4)
  for (let index = 0; index < 12; index++) api.trackEvent(event('PRODUCT_VIEWED', { productId: 'p' + index }), 'limited-user')
  assert.equal(api.getRecentlyViewedProductIds('limited-user').length, api.RECENTLY_VIEWED_LIMIT)
  await api.flushAnalytics()
})

test('compras deduplicadas tras truncar el log, recargar y repetir Order ID', async t => {
  analyticsEnvironment(t)
  const { api } = await loadAnalytics()
  api.trackEvent(event('PURCHASE_COMPLETED', { orderId: 'order-1' }), 'buyer')
  api.trackEvent(event('PURCHASE_COMPLETED', { orderId: 'order-1' }), 'buyer')
  api.trackEvent(event('PURCHASE_COMPLETED', { orderId: '   ' }), 'buyer')
  for (let i = 0; i < 507; i++) api.trackEvent(event('CHECKOUT_STARTED'), 'buyer')
  await api.flushAnalytics()
  assert.equal(api.getAnalyticsEvents('buyer').length, 500)
  assert.equal(api.getAnalyticsCounters('buyer').checkouts, 507)
  assert.equal(api.getAnalyticsEvents('buyer').some(saved => saved.type === 'PURCHASE_COMPLETED'), false)
  const { api: reload } = await loadAnalytics()
  reload.trackEvent(event('PURCHASE_COMPLETED', { orderId: 'order-1' }), 'buyer')
  reload.trackEvent(event('PURCHASE_COMPLETED', { orderId: 'order-2' }), 'buyer')
  await reload.flushAnalytics()
  assert.equal(reload.getAnalyticsCounters('buyer').purchases, 2)
  assert.equal(reload.getAnalyticsCounters('buyer').checkouts, 507)
})

test('las cuatro métricas conservan acumulados y aislamiento por usuario', async t => {
  analyticsEnvironment(t)
  const { api } = await loadAnalytics()
  api.trackEvent(event('PRODUCT_VIEWED', { productId: 'p1' }), 'u')
  api.trackEvent(event('PRODUCT_VIEWED', { productId: 'p1' }), 'u')
  api.trackEvent(event('SEARCH_PERFORMED', { source: 'catalog' }), 'u')
  api.trackEvent(event('SEARCH_PERFORMED', { source: 'recent' }), 'u')
  api.trackEvent(event('CART_ITEM_ADDED', { productId: 'p1', quantity: 9 }), 'u')
  api.trackEvent(event('PURCHASE_COMPLETED', { orderId: 'o' }), 'u')
  api.trackEvent(event('PURCHASE_COMPLETED', { orderId: 'o' }), 'u')
  api.trackEvent(event('CART_ITEM_ADDED', { productId: 'p1', quantity: 1 }), 'other')
  await api.flushAnalytics()
  const { api: reload } = await loadAnalytics()
  assert.deepEqual(reload.getAnalyticsCounters('u'), { sessions: 0, searches: 2, productViews: 2, cartAdds: 1, checkouts: 0, purchases: 1 })
  assert.equal(reload.getAnalyticsCounters('other').cartAdds, 1)
  assert.equal(reload.getAnalyticsCounters().cartAdds, 0)
})

test('migra v1 válida conservando acumulados, dedup e IDs recientes; no borra el original', async t => {
  const { stored } = analyticsEnvironment(t)
  const { api } = await loadAnalytics()
  const legacyKey = api.analyticsStorage.legacyKeyPrefix + 'user:migrated'
  const legacy = JSON.stringify({ events: [event('PURCHASE_COMPLETED', { orderId: 'old-order' })],
    counters: { sessions: 4, searches: 900, productViews: 800, cartAdds: 600, checkouts: 20, purchases: 1 },
    recentProductIds: ['p2', 'p1'], completedOrderIds: ['old-order'] })
  stored.set(legacyKey, legacy)
  const id = api.getAnalyticsEvents('migrated')[0].eventId
  const { api: other } = await loadAnalytics()
  assert.equal(other.getAnalyticsEvents('migrated')[0].eventId, id)
  api.trackEvent(event('PURCHASE_COMPLETED', { orderId: 'old-order' }), 'migrated')
  api.trackEvent(event('SESSION_STARTED', { role: 'B2C' }), 'migrated')
  await api.flushAnalytics()
  const { api: reload } = await loadAnalytics()
  assert.deepEqual(reload.getAnalyticsCounters('migrated'), { sessions: 5, searches: 900, productViews: 800, cartAdds: 600, checkouts: 20, purchases: 1 })
  assert.deepEqual(reload.getRecentlyViewedProductIds('migrated'), ['p2', 'p1'])
  assert.equal(reload.getAnalyticsEvents('migrated')[0].eventId, id)
  assert.equal(stored.get(legacyKey), legacy)
})

const validState = () => ({ schemaVersion: 2, userId: 'u',
  events: [{ ...event('PURCHASE_COMPLETED', { orderId: 'o' }), schemaVersion: 2, userId: 'u', eventId: 'saved-id' }],
  counters: { sessions: 0, searches: 0, productViews: 0, cartAdds: 0, checkouts: 0, purchases: 1 },
  recentProductIds: [], completedOrderIds: ['o'] })
const invalidSnapshots = [
  ['JSON corrupto', () => '{'],
  ['schema incompatible', state => { state.schemaVersion = 99 }],
  ['event schema incompatible', state => { state.events[0].schemaVersion = 99 }],
  ['eventId vacío', state => { state.events[0].eventId = '' }],
  ['owner ajeno', state => { state.events[0].userId = 'another' }],
  ['snapshot owner ajeno', state => { state.userId = 'another' }],
  ['fecha inválida', state => { state.events[0].occurredAt = '2026-02-30T12:00:00.000Z' }],
  ['tipo desconocido', state => { state.events[0].type = 'OTHER' }],
  ['Order ID vacío', state => { state.events[0].metadata.orderId = ' ' }],
  ['metadata sensible extra', state => { state.events[0].metadata.query = 'must-not-persist' }],
  ['campo raíz extra', state => { state.extra = true }],
  ['contador negativo', state => { state.counters.searches = -1 }],
  ['contador fraccionario', state => { state.counters.searches = 0.1 }],
  ['contador inseguro', state => { state.counters.searches = Number.MAX_SAFE_INTEGER + 1 }],
  ['purchases incoherente', state => { state.counters.purchases = 42 }],
  ['referencia duplicada', state => { state.completedOrderIds = ['o', 'o']; state.counters.purchases = 2 }],
  ['compra sin referencia', state => { state.completedOrderIds = []; state.counters.purchases = 0 }],
  ['eventId duplicado', state => { state.events.push(structuredClone(state.events[0])) }],
  ['contador menor al log', state => { state.events = [{ ...state.events[0], type: 'PRODUCT_VIEWED', metadata: { productId: 'p' } }] }],
]
for (const [name, mutate] of invalidSnapshots) test('hidrata fail-open sin sobrescribir: ' + name, async t => {
  const { stored } = analyticsEnvironment(t)
  const { api } = await loadAnalytics()
  const state = validState(), result = mutate(state)
  const raw = typeof result === 'string' ? result : JSON.stringify(state)
  const key = api.analyticsStorage.keyPrefix + 'user:u'
  stored.set(key, raw)
  assert.equal(api.getAnalyticsCounters('u').purchases, 0)
  assert.doesNotThrow(() => api.trackEvent(event('SEARCH_PERFORMED', { source: 'catalog' }), 'u'))
  await api.flushAnalytics()
  assert.equal(api.getAnalyticsCounters('u').searches, 1)
  assert.equal(stored.get(key), raw)
})

test('rechaza inputs inválidos y extras; no persiste query, PII ni metadata arbitraria', async t => {
  const { stored } = analyticsEnvironment(t)
  const { api } = await loadAnalytics()
  for (const input of [
    event('SEARCH_PERFORMED', { source: 'catalog', query: 'private' }),
    event('CART_ITEM_ADDED', { productId: 'p', quantity: 0 }),
    event('PRODUCT_VIEWED', { productId: '' }),
    event('SESSION_STARTED', { role: ['B2C'] }),
    { ...event('CHECKOUT_STARTED'), buyer: 'private' },
    { ...event('CHECKOUT_STARTED'), occurredAt: 'not-a-date' },
    event('UNKNOWN'),
  ]) assert.doesNotThrow(() => api.trackEvent(input, 'u'))
  api.trackEvent(event('CHECKOUT_STARTED'), ' ')
  assert.deepEqual(api.getAnalyticsEvents('u'), [])
  assert.equal(stored.size, 0)
  api.trackEvent(event('SEARCH_PERFORMED', { source: 'catalog' }), 'u')
  await api.flushAnalytics()
  assert.equal([...stored.values()].some(raw => /private|query|buyer/.test(raw)), false)
})

test('storage bloqueado/quota no bloquean acciones; recupera el buffer al volver a guardar', async t => {
  const { storage } = analyticsEnvironment(t)
  const { api } = await loadAnalytics()
  const get = storage.getItem, set = storage.setItem
  storage.getItem = () => { throw new Error('blocked') }
  storage.setItem = () => { throw new Error('quota') }
  assert.doesNotThrow(() => api.trackEvent(event('PURCHASE_COMPLETED', { orderId: 'o' }), 'u'))
  await api.flushAnalytics()
  api.refreshAnalyticsState('u')
  assert.equal(api.getAnalyticsCounters('u').purchases, 1)
  storage.getItem = get
  api.trackEvent(event('SEARCH_PERFORMED', { source: 'catalog' }), 'u')
  await api.flushAnalytics()
  assert.equal(api.getAnalyticsCounters('u').searches, 1)
  storage.setItem = set
  api.trackEvent(event('PRODUCT_VIEWED', { productId: 'p' }), 'u')
  await api.flushAnalytics()
  const { api: reload } = await loadAnalytics()
  assert.equal(reload.getAnalyticsCounters('u').purchases, 1)
  assert.equal(reload.getAnalyticsCounters('u').searches, 1)
  assert.equal(reload.getAnalyticsCounters('u').productViews, 1)
})

test('sin Web Locks conserva actividad en memoria y no sobrescribe storage', async t => {
  const { stored } = analyticsEnvironment(t, { locks: false })
  const { api } = await loadAnalytics()
  api.trackEvent(event('CART_ITEM_ADDED', { productId: 'p', quantity: 1 }), 'u')
  await api.flushAnalytics()
  assert.equal(api.getAnalyticsCounters('u').cartAdds, 1)
  assert.equal(stored.size, 0)
})

test('un lock rechazado no bloquea Analytics ni una acción comercial', async t => {
  const { stored } = analyticsEnvironment(t)
  navigator.locks.request = async () => { throw new Error('lock denied') }
  const { api } = await loadAnalytics()
  let accepted = false
  assert.doesNotThrow(() => {
    api.trackEvent(event('CART_ITEM_ADDED', { productId: 'p', quantity: 1 }), 'u')
    accepted = true
  })
  await api.flushAnalytics()
  assert.equal(accepted, true)
  assert.equal(api.getAnalyticsCounters('u').cartAdds, 1)
  assert.equal(stored.size, 0)
})
