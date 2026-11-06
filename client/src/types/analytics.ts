/** Contratos de eventos de producto sin consultas, datos personales ni información de pago. */
export type AnalyticsEvent =
  | { type: 'SESSION_STARTED'; occurredAt: string; metadata: { role: 'B2C' | 'B2B' } }
  | { type: 'SEARCH_PERFORMED'; occurredAt: string; metadata: { source: 'catalog' | 'recent' } }
  | { type: 'PRODUCT_VIEWED'; occurredAt: string; metadata: { productId: string } }
  | { type: 'CART_ITEM_ADDED'; occurredAt: string; metadata: { productId: string; quantity: number } }
  | { type: 'CHECKOUT_STARTED'; occurredAt: string; metadata: Record<string, never> }
  | { type: 'PURCHASE_COMPLETED'; occurredAt: string; metadata: { orderId: string } }

export type AnalyticsCounters = {
  sessions: number
  searches: number
  productViews: number
  cartAdds: number
  checkouts: number
  purchases: number
}
