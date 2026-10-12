import type { OrderItem, OrderTotals } from '../types/order.js'
import { OrderError } from './orderError.js'

/** Usa centavos enteros para evitar errores de punto flotante en importes monetarios. */
function cents(value: number): number {
  const result = Math.round(value * 100)
  if (!Number.isFinite(value) || value < 0 || !Number.isSafeInteger(result)) {
    throw new OrderError(400, 'CHECKOUT_VALIDATION_ERROR', 'No se pueden calcular los importes de la orden.')
  }
  return result
}
function safe(value: number): number {
  if (!Number.isSafeInteger(value)) throw new OrderError(400, 'CHECKOUT_VALIDATION_ERROR', 'El importe de la orden excede el límite permitido.')
  return value
}
export function calculateLineSubtotal(unitPrice: number, quantity: number): number {
  return safe(cents(unitPrice) * quantity) / 100
}
export function calculateOrderTotals(items: readonly OrderItem[]): OrderTotals {
  const subtotalCents = items.reduce((sum, item) => safe(sum + cents(item.lineSubtotal)), 0)
  const taxCents = safe(Math.round(subtotalCents * 0.13))
  const shippingCents = subtotalCents > 0 && subtotalCents < 10000000 ? 350000 : 0
  const totalCents = safe(subtotalCents + taxCents + shippingCents)
  return { subtotal: subtotalCents / 100, tax: taxCents / 100, shipping: shippingCents / 100, total: totalCents / 100 }
}
