/** Envía solicitudes de creación de Order y valida las respuestas y errores recibidos por HTTP. */
import type { ApiErrorResponse } from '../types/apiError'
import type { CreateOrderRequest, Order } from '../types/order'

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL?.trim() || '').replace(/\/+$/, '')

export class OrderApiError extends Error {
  readonly code: ApiErrorResponse['error']['code']
  readonly conclusive: boolean
  readonly fieldErrors?: Record<string, string>

  /** Conserva código, certeza del fallo y errores de campo para orientar la recuperación de Checkout. */
  constructor(code: ApiErrorResponse['error']['code'], conclusive: boolean, fieldErrors?: Record<string, string>) {
    super('No se pudo crear la orden.')
    this.name = 'OrderApiError'
    this.code = code
    this.conclusive = conclusive
    this.fieldErrors = fieldErrors
  }
}

/** Comprueba que el valor desconocido sea un objeto no nulo y no un arreglo. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
/** Comprueba la estructura pública, moneda y coherencia de estados de una Order recibida por HTTP. */
function isOrder(value: unknown): value is Order {
  if (!isRecord(value) || !isRecord(value.buyer) || !isRecord(value.delivery) || !isRecord(value.totals)) return false
  /** Comprueba que el valor recibido sea texto no vacío después de recortar espacios. */
  const text = (value: unknown) => typeof value === 'string' && value.trim().length > 0
  /** Comprueba que el valor recibido sea un importe numérico finito y no negativo. */
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

/** Envía solo datos de comprador, entrega, referencias y clave; devuelve una Order validada o un error público. */
async function createOrder(request: CreateOrderRequest): Promise<Order> {
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
  
  // Acepta respuestas de creación o replay; ambas deben contener una Order válida.
  if (response.status !== 201 && response.status !== 200) {
    const code = isRecord(body) && isRecord(body.error) ? body.error.code : undefined
    const fieldErrors = isRecord(body) && isRecord(body.error) && isRecord(body.error.fieldErrors) 
      ? body.error.fieldErrors as Record<string, string> 
      : undefined

    const known = ['CHECKOUT_VALIDATION_ERROR', 'EMPTY_CART', 'PRODUCT_NOT_FOUND']
    throw new OrderApiError(
      known.includes(String(code)) ? code as ApiErrorResponse['error']['code'] : 'UNEXPECTED_ERROR', 
      [400, 404, 413, 422].includes(response.status),
      fieldErrors
    )
  }
  
  if (!isOrder(body)) throw new OrderApiError('UNEXPECTED_ERROR', false)
  return body
}
export const orderApi = { createOrder }

/** Convierte un error de creación en un mensaje público sin exponer detalles internos. */
export function orderErrorMessage(error: unknown): string {
  if (error instanceof OrderApiError) {
    if (error.code === 'PRODUCT_NOT_FOUND') return 'Uno de los productos ya no esta disponible. Revisa tu carrito antes de continuar.'
    if (error.code === 'EMPTY_CART') return 'Agrega productos al carrito para continuar.'
    if (error.code === 'CHECKOUT_VALIDATION_ERROR') return 'Revisa los datos del comprador y la entrega. Corrige los campos para continuar.'
  }
  return 'Ocurrio un problema inesperado. Intentalo nuevamente.'
}
