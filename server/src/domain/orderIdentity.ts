/** Identidad canónica V1, independiente de la persistencia y de los precios actuales del catálogo. */
import { OrderError } from './orderError.js'
import type { CreateOrderRequest } from '../types/order.js'

export function orderQuantities(items: CreateOrderRequest['items']): Map<string, number> {
  const result = new Map<string, number>()
  for (const { productId, quantity } of items) {
    const total = (result.get(productId) ?? 0) + quantity
    if (!Number.isSafeInteger(total)) throw new OrderError(400, 'CHECKOUT_VALIDATION_ERROR', 'La cantidad total de un producto excede el límite permitido.')
    result.set(productId, total)
  }
  return result
}

export function orderIdentity({ buyer, delivery, items, termsAcceptance }: Pick<CreateOrderRequest, 'buyer' | 'delivery' | 'items' | 'termsAcceptance'>): string {
  return JSON.stringify([
    termsAcceptance.accepted, termsAcceptance.version,
    buyer.fullName, buyer.email, buyer.phone,
    delivery.province, delivery.canton, delivery.address, delivery.additionalInfo ?? '',
    [...orderQuantities(items)].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0),
  ])
}

export function requireCompatible(expected: string, received: string): void {
  if (expected !== received) throw new OrderError(409, 'CHECKOUT_VALIDATION_ERROR', 'La clave de idempotencia ya está asociada a una solicitud diferente.', { idempotencyKey: 'Utiliza la misma clave únicamente para repetir la misma compra.' })
}

export function requireOrderOwner(expected: unknown, received: string): void {
  if (typeof expected !== 'string' || !expected || expected !== received) throw new OrderError(404, 'ORDER_NOT_FOUND', 'La orden solicitada no existe.')
}
