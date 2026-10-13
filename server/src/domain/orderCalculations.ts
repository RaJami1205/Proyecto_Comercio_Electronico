import type { OrderItem, OrderTotals } from '../types/order.js'
import { OrderError } from './orderError.js'

/** Conserva la precisión del number original y el límite monetario defensivo. */
function amount(value: number): number {
  if (!Number.isFinite(value) || value < 0 || value > Number.MAX_SAFE_INTEGER / 100) {
    throw new OrderError(400, 'CHECKOUT_VALIDATION_ERROR', 'No se pueden calcular los importes de la orden.')
  }
  return value
}
export function calculateLineSubtotal(unitPrice: number, quantity: number): number {
  return amount(amount(unitPrice) * quantity)
}
export function calculateOrderTotals(items: readonly OrderItem[]): OrderTotals {
  const subtotal = items.reduce((sum, item) => amount(sum + amount(item.lineSubtotal)), 0)
  // El umbral se evalúa antes de cualquier redondeo y antes del IVA, sin tolerancias.
  const shipping = subtotal > 0 && subtotal < 100000 ? 3500 : 0
  // Conserva el redondeo existente del IVA a centavos; no redondea el subtotal ni el total.
  const tax = amount(Math.round(subtotal * 100 * 0.13) / 100)
  const total = amount(subtotal + tax + shipping)
  return { subtotal, tax, shipping, total }
}
