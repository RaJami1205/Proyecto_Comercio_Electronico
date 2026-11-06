/** Comprueba aislamiento por identidad, límites, persistencia y deduplicación del módulo de analítica. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

const source = readFileSync(new URL('../src/services/analytics.ts', import.meta.url), 'utf8')
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ESNext } }).outputText
const analytics = await import('data:text/javascript;base64,' + Buffer.from(compiled).toString('base64'))
const stored = new Map()
globalThis.window = {
  localStorage: {
    getItem: key => stored.get(key) ?? null,
    setItem: (key, value) => stored.set(key, value),
  },
  dispatchEvent: () => true,
}

test('separa eventos anónimos y de cada identidad, y restaura snapshots desde localStorage', () => {
  analytics.trackEvent({ type: 'SESSION_STARTED', occurredAt: '2026-11-06T12:00:00.000Z', metadata: { role: 'B2C' } }, 'user-a')
  analytics.trackEvent({ type: 'SEARCH_PERFORMED', occurredAt: '2026-11-06T12:01:00.000Z', metadata: { source: 'catalog' } })
  assert.equal(analytics.getAnalyticsCounters('user-a').sessions, 1)
  assert.equal(analytics.getAnalyticsCounters('user-a').searches, 0)
  assert.equal(analytics.getAnalyticsCounters('user-b').sessions, 0)
  assert.equal(analytics.getAnalyticsCounters().searches, 1)
  assert.ok([...stored.keys()].some(key => key.endsWith('user:user-a')))
})

test('registra productos vistos una vez y ordenados por la visita más reciente', () => {
  for (const productId of ['p1', 'p2', 'p1', 'p3']) {
    analytics.trackEvent({ type: 'PRODUCT_VIEWED', occurredAt: new Date().toISOString(), metadata: { productId } }, 'history-user')
  }
  assert.deepEqual(analytics.getRecentlyViewedProductIds('history-user'), ['p3', 'p1', 'p2'])
  assert.equal(analytics.getAnalyticsCounters('history-user').productViews, 4)
})

test('la compra requiere Order ID y solo incrementa una vez por ID', () => {
  const purchase = orderId => analytics.trackEvent({ type: 'PURCHASE_COMPLETED', occurredAt: new Date().toISOString(), metadata: { orderId } }, 'buyer')
  purchase('order-1')
  purchase('order-1')
  purchase('   ')
  purchase('order-2')
  assert.equal(analytics.getAnalyticsCounters('buyer').purchases, 2)
  assert.deepEqual(analytics.getAnalyticsEvents('buyer').filter(event => event.type === 'PURCHASE_COMPLETED').map(event => event.metadata.orderId), ['order-1', 'order-2'])
})

test('acota el historial de eventos y se mantiene operativo si falla localStorage', () => {
  for (let index = 0; index < analytics.analyticsStorage.maxEvents + 7; index++) {
    analytics.trackEvent({ type: 'CHECKOUT_STARTED', occurredAt: new Date().toISOString(), metadata: {} }, 'bounded-user')
  }
  assert.equal(analytics.getAnalyticsEvents('bounded-user').length, analytics.analyticsStorage.maxEvents)
  window.localStorage.setItem = () => { throw new Error('quota') }
  analytics.trackEvent({ type: 'SEARCH_PERFORMED', occurredAt: new Date().toISOString(), metadata: { source: 'recent' } }, 'memory-user')
  assert.equal(analytics.getAnalyticsCounters('memory-user').searches, 1)
})
