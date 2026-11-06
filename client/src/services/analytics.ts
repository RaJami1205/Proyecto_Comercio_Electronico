/** Guarda métricas versionadas por identidad, manteniendo una partición anónima aislada. */
import type { AnalyticsCounters, AnalyticsEvent } from '../types/analytics'

const STORAGE_PREFIX = 'cibernova:analytics:v1:'
const MAX_EVENTS = 500
const MAX_RECENT_PRODUCTS = 10
const changedEvent = 'cibernova:analytics-changed'

interface AnalyticsState {
  events: AnalyticsEvent[]
  counters: AnalyticsCounters
  recentProductIds: string[]
  completedOrderIds: string[]
}

const memory = new Map<string, AnalyticsState>()
const emptyCounters = (): AnalyticsCounters => ({ sessions: 0, searches: 0, productViews: 0, cartAdds: 0, checkouts: 0, purchases: 0 })
const emptyState = (): AnalyticsState => ({ events: [], counters: emptyCounters(), recentProductIds: [], completedOrderIds: [] })
const scopeFor = (userId?: string | null) => userId?.trim()
  ? `user:${encodeURIComponent(userId.trim())}`
  : 'anonymous'

function readState(scope: string): AnalyticsState {
  const cached = memory.get(scope)
  if (cached) return cached
  let state = emptyState()
  try {
    const raw = window.localStorage.getItem(`${STORAGE_PREFIX}${scope}`)
    if (raw) {
      const parsed: unknown = JSON.parse(raw)
      if (isState(parsed)) state = parsed
    }
  } catch { /* localStorage puede estar deshabilitado o contener JSON corrupto. */ }
  memory.set(scope, state)
  return state
}

function isState(value: unknown): value is AnalyticsState {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Record<string, unknown>
  if (!Array.isArray(record.events) || !Array.isArray(record.recentProductIds)
    || !Array.isArray(record.completedOrderIds) || typeof record.counters !== 'object' || record.counters === null) return false
  const counters = record.counters as Record<string, unknown>
  return ['sessions', 'searches', 'productViews', 'cartAdds', 'checkouts', 'purchases']
    .every((key) => Number.isSafeInteger(counters[key]) && Number(counters[key]) >= 0)
}

function writeState(scope: string, state: AnalyticsState) {
  memory.set(scope, state)
  try { window.localStorage.setItem(`${STORAGE_PREFIX}${scope}`, JSON.stringify(state)) }
  catch { /* La sesión sigue registrando en memoria si el navegador rechaza escritura. */ }
  try { window.dispatchEvent(new Event(changedEvent)) } catch { /* No hay entorno DOM durante SSR. */ }
}

/** Agrega un evento validado al scope actual sin contaminar el historial anónimo o de otra cuenta. */
export function trackEvent(event: AnalyticsEvent, userId?: string | null): void {
  if (typeof window === 'undefined' || !event || typeof event.type !== 'string') return
  const scope = scopeFor(userId)
  const current = readState(scope)
  if (event.type === 'PURCHASE_COMPLETED') {
    const orderId = event.metadata.orderId.trim()
    if (!orderId || current.completedOrderIds.includes(orderId)) return
    writeState(scope, {
      ...current,
      events: [...current.events, { ...event, metadata: { orderId } }].slice(-MAX_EVENTS),
      counters: { ...current.counters, purchases: current.counters.purchases + 1 },
      completedOrderIds: [...current.completedOrderIds, orderId],
    })
    return
  }
  let recentProductIds = current.recentProductIds
  if (event.type === 'PRODUCT_VIEWED' && event.metadata.productId.trim()) {
    const id = event.metadata.productId.trim()
    recentProductIds = [id, ...recentProductIds.filter((productId) => productId !== id)].slice(0, MAX_RECENT_PRODUCTS)
  }
  const counterByType: Record<AnalyticsEvent['type'], keyof AnalyticsCounters> = {
    SESSION_STARTED: 'sessions', SEARCH_PERFORMED: 'searches', PRODUCT_VIEWED: 'productViews',
    CART_ITEM_ADDED: 'cartAdds', CHECKOUT_STARTED: 'checkouts', PURCHASE_COMPLETED: 'purchases',
  }
  const counter = counterByType[event.type]
  writeState(scope, { ...current, events: [...current.events, event].slice(-MAX_EVENTS),
    counters: { ...current.counters, [counter]: current.counters[counter] + 1 }, recentProductIds })
}

/** Devuelve contadores derivados de eventos, sin exponer los datos de checkout. */
export function getAnalyticsCounters(userId?: string | null): AnalyticsCounters {
  return { ...readState(scopeFor(userId)).counters }
}

/** Expone IDs de productos vistos en orden de uso reciente para resolverlos desde el catálogo vivo. */
export function getRecentlyViewedProductIds(userId?: string | null): string[] {
  return [...readState(scopeFor(userId)).recentProductIds]
}

/** Expone un snapshot de eventos para soporte de métricas y pruebas, sin acceso a datos de identidad. */
export function getAnalyticsEvents(userId?: string | null): AnalyticsEvent[] {
  return [...readState(scopeFor(userId)).events]
}

export const analyticsStorage = { keyPrefix: STORAGE_PREFIX, maxEvents: MAX_EVENTS, changedEvent }
