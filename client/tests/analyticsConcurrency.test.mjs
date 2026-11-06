import test from 'node:test'
import assert from 'node:assert/strict'
import { analyticsEnvironment, loadAnalytics, event } from './helpers/analyticsHarness.mjs'

test('F6 dos pestañas con el mismo snapshot no pierden búsquedas ni compras', async t => {
  analyticsEnvironment(t)
  const { api: a } = await loadAnalytics(), { api: b } = await loadAnalytics()
  assert.equal(a.getAnalyticsCounters('same-user').searches, 0)
  assert.equal(b.getAnalyticsCounters('same-user').searches, 0)
  a.trackEvent(event('SEARCH_PERFORMED', { source: 'catalog' }), 'same-user')
  b.trackEvent(event('SEARCH_PERFORMED', { source: 'recent' }), 'same-user')
  a.trackEvent(event('PURCHASE_COMPLETED', { orderId: 'order-a' }), 'same-user')
  b.trackEvent(event('PURCHASE_COMPLETED', { orderId: 'order-b' }), 'same-user')
  await Promise.all([a.flushAnalytics?.(), b.flushAnalytics?.()])
  const { api: reload } = await loadAnalytics()
  assert.equal(reload.getAnalyticsCounters('same-user').searches, 2)
  assert.equal(reload.getAnalyticsCounters('same-user').purchases, 2)
})

test('F6 una misma compra concurrente se cuenta una vez y conserva otros eventos', async t => {
  analyticsEnvironment(t)
  const { api: a } = await loadAnalytics(), { api: b } = await loadAnalytics()
  a.getAnalyticsCounters('u'); b.getAnalyticsCounters('u')
  a.trackEvent(event('PURCHASE_COMPLETED', { orderId: 'same-order' }), 'u')
  b.trackEvent(event('PURCHASE_COMPLETED', { orderId: 'same-order' }), 'u')
  a.trackEvent(event('CART_ITEM_ADDED', { productId: 'p', quantity: 1 }), 'u')
  b.trackEvent(event('PRODUCT_VIEWED', { productId: 'p' }), 'u')
  // Reconciliar antes de adquirir el lock tampoco puede descartar el buffer.
  b.refreshAnalyticsState('u')
  await Promise.all([a.flushAnalytics(), b.flushAnalytics()])
  a.refreshAnalyticsState('u')
  assert.equal(a.getAnalyticsCounters('u').purchases, 1)
  assert.equal(a.getAnalyticsCounters('u').cartAdds, 1)
  assert.equal(a.getAnalyticsCounters('u').productViews, 1)
  const { api: reload } = await loadAnalytics()
  reload.trackEvent(event('PURCHASE_COMPLETED', { orderId: 'same-order' }), 'u')
  assert.equal(reload.getAnalyticsCounters('u').purchases, 1)
})
