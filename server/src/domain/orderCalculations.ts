/** Calcula importes autoritativos de Order con IVA y elegibilidad de envío, preservando los subtotales originales. */
import type { OrderItem, OrderTotals } from '../types/order.js'
import { OrderError } from './orderError.js'

/** Conserva la precisión del number original y el límite monetario defensivo. */
function amount(value: number): number {
  if (!Number.isFinite(value) || value < 0 || value > Number.MAX_SAFE_INTEGER / 100) {
    throw new OrderError(400, 'CHECKOUT_VALIDATION_ERROR', 'No se pueden calcular los importes de la orden.')
  }
  return value
}
/** Multiplica precio unitario por cantidad y rechaza importes fuera del rango monetario admitido. */
export function calculateLineSubtotal(unitPrice: number, quantity: number): number {
  return amount(amount(unitPrice) * quantity)
}
/** Acumula líneas sin redondearlas, calcula IVA a centavos y usa el subtotal redondeado solo para elegibilidad de envío. */
export function calculateOrderTotals(items: readonly OrderItem[]): OrderTotals {
  const subtotal = items.reduce((sum, item) => amount(sum + amount(item.lineSubtotal)), 0)
  // Redondea la suma completa a CRC enteros solo para elegibilidad, antes del IVA.
  const shipping = subtotal > 0 && Math.round(subtotal) < 100000 ? 3500 : 0
  // Conserva el redondeo existente del IVA a centavos; no redondea el subtotal ni el total.
  const tax = amount(Math.round(subtotal * 100 * 0.13) / 100)
  const total = amount(subtotal + tax + shipping)
  return { subtotal, tax, shipping, total }
}
