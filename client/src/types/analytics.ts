/** Contratos de eventos de producto sin consultas, datos personales ni información de pago. */
export type AnalyticsEventInput =
  | { type: 'SESSION_STARTED'; occurredAt: string; metadata: { role: 'B2C' | 'B2B' | 'ADMIN' } }
  | { type: 'SEARCH_PERFORMED'; occurredAt: string; metadata: { source: 'catalog' | 'recent' } }
  | { type: 'PRODUCT_VIEWED'; occurredAt: string; metadata: { productId: string } }
  | { type: 'CART_ITEM_ADDED'; occurredAt: string; metadata: { productId: string; quantity: number } }
  | { type: 'CHECKOUT_STARTED'; occurredAt: string; metadata: Record<string, never> }
  | { type: 'PURCHASE_COMPLETED'; occurredAt: string; metadata: { orderId: string } }

/** Envelope creado una sola vez; null identifica explícitamente el scope anónimo. */
export type AnalyticsEvent = AnalyticsEventInput & {
  eventId: string
  userId: string | null
  schemaVersion: 2
}

/** Acumulados por scope. Cada adición al Cart cuenta como una acción independientemente de la cantidad. */
export type AnalyticsCounters = {
  sessions: number
  searches: number
  productViews: number
  cartAdds: number
  checkouts: number
  purchases: number
}

/** persistent: snapshot local válido sin escrituras pendientes; pending: escritura coordinada en curso;
 * memory-only: sin localStorage/Web Locks o última escritura fallida;
 * incompatible: snapshot corrupto o de otra versión, que se conserva intacto mientras la sesión sigue en memoria. */
export type AnalyticsStorageStatus = 'persistent' | 'pending' | 'memory-only' | 'incompatible'

/** Proyección administrativa derivada; nunca se guarda como otro acumulado. */
export type AnalyticsAggregateCounters = Pick<AnalyticsCounters, 'productViews' | 'searches' | 'cartAdds' | 'purchases'>
/** Señales independientes de cobertura y escritura. Un agregado puede incluir actividad en memoria y omitir datos ilegibles a la vez. */
export interface AnalyticsAggregatePersistence {
  pending: boolean
  memoryOnly: boolean
  unavailable: boolean
  excludedScopes: number
}
/** Entrega cifras y su cobertura juntas, o un error cuando no se puede representar el agregado. */
export type AnalyticsAggregateSnapshot =
  | { status: 'ready'; counters: AnalyticsAggregateCounters; persistence: AnalyticsAggregatePersistence }
  | { status: 'error' }
