import type { ApiErrorResponse } from '../types/apiError'
import type { CreateOrderRequest, Order } from '../types/order'

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL?.trim() || '').replace(/\/+$/, '')

export class OrderApiError extends Error {
  readonly code: ApiErrorResponse['error']['code']
  readonly conclusive: boolean
  constructor(code: ApiErrorResponse['error']['code'], conclusive: boolean) {
    super('No se pudo crear la orden.')
    this.name = 'OrderApiError'
    this.code = code
    this.conclusive = conclusive
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
function isOrder(value: unknown): value is Order {
  if (!isRecord(value) || !isRecord(value.buyer) || !isRecord(value.delivery) || !isRecord(value.totals)) return false
  const text = (value: unknown) => typeof value === 'string' && value.trim().length > 0
  const money = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0
  return text(value.id) && text(value.orderNumber) && typeof value.createdAt === 'string' && Number.isFinite(Date.parse(value.createdAt))
    && ['fullName', 'email', 'phone'].every(key => text((value.buyer as Record<string, unknown>)[key]))
    && ['province', 'canton', 'address'].every(key => text((value.delivery as Record<string, unknown>)[key]))
    && (value.delivery.additionalInfo === undefined || typeof value.delivery.additionalInfo === 'string')
    && value.currency === 'CRC'
    && ((value.orderStatus === 'PENDING' && (value.paymentStatus === 'PENDING' || value.paymentStatus === 'DECLINED' || value.paymentStatus === 'ERROR'))
      || (value.orderStatus === 'CONFIRMED' && value.paymentStatus === 'APPROVED'))
    && ['subtotal', 'tax', 'shipping', 'total'].every(key => money((value.totals as Record<string, unknown>)[key]))
    && Array.isArray(value.items) && value.items.length > 0 && value.items.every(item => isRecord(item)
      && text(item.productId) && text(item.name) && typeof item.image === 'string' && money(item.unitPrice)
      && typeof item.quantity === 'number' && Number.isSafeInteger(item.quantity) && item.quantity > 0 && money(item.lineSubtotal))
}

async function createOrder(request: CreateOrderRequest): Promise<Order> {
  // Construye explícitamente el contrato, incluso si el caller tiene campos adicionales.
  const payload: CreateOrderRequest = {
    buyer: request.buyer, delivery: request.delivery,
    items: request.items.map(({ productId, quantity }) => ({ productId, quantity })),
    idempotencyKey: request.idempotencyKey,
  }
  const response = await fetch(API_BASE_URL + '/api/orders', {
    method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify(payload), signal: AbortSignal.timeout(20000),
  })
  const body: unknown = await response.json().catch(() => null)
  if (response.status !== 201) {
    const code = isRecord(body) && isRecord(body.error) ? body.error.code : undefined
    const known = ['CHECKOUT_VALIDATION_ERROR', 'EMPTY_CART', 'PRODUCT_NOT_FOUND']
    throw new OrderApiError(known.includes(String(code)) ? code as ApiErrorResponse['error']['code'] : 'UNEXPECTED_ERROR', [400, 404, 413, 422].includes(response.status))
  }
  if (!isOrder(body)) throw new OrderApiError('UNEXPECTED_ERROR', false)
  return body
}

export const orderApi = { createOrder }

export function orderErrorMessage(error: unknown): string {
  if (error instanceof OrderApiError) {
    if (error.code === 'PRODUCT_NOT_FOUND') return 'Uno de los productos ya no está disponible. Revisa tu carrito antes de continuar.'
    if (error.code === 'EMPTY_CART') return 'Agrega productos al carrito para continuar.'
    if (error.code === 'CHECKOUT_VALIDATION_ERROR') return 'Revisa los datos del comprador, la entrega y las cantidades antes de confirmar.'
  }
  return 'No pudimos confirmar la creación de tu orden. Inténtalo de nuevo; conservaremos este intento para evitar duplicados.'
}
