import type { Order } from '../types/order'

/** Cada Order aprobada limpia una sola vez, sin borrar compras agregadas después de un replay. */
export function createPaidOrderCartCleanup(clearCart: () => void): (order: Order | undefined) => void {
  const clearedOrderIds = new Set<string>()
  return order => {
    if (!order?.id || order.orderStatus !== 'CONFIRMED' || order.paymentStatus !== 'APPROVED' || clearedOrderIds.has(order.id)) return
    clearCart()
    clearedOrderIds.add(order.id)
  }
}
