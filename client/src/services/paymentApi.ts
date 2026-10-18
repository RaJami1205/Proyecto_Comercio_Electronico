/** Envía intentos al Payment Sandbox y valida que la respuesta corresponda a la Order y al escenario solicitados. */
import type { ApiErrorResponse } from '../types/apiError'
import type { Order } from '../types/order'
import type { PaymentResult, PaymentScenario, ProcessPaymentRequest } from '../types/payment'

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL?.trim() || '').replace(/\/+$/, '')

export class PaymentApiError extends Error {
  readonly code: ApiErrorResponse['error']['code']
  readonly conclusive: boolean
  /** Conserva el código público y la certeza del fallo para distinguir errores del intento de pago. */
  constructor(code: ApiErrorResponse['error']['code'], conclusive: boolean) {
    super('No se pudo procesar el pago.')
    this.name = 'PaymentApiError'
    this.code = code
    this.conclusive = conclusive
  }
}

/** Comprueba que el valor desconocido sea un objeto no nulo y no un arreglo. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

const SCENARIOS: readonly PaymentScenario[] = ['PAYMENT_APPROVED', 'PAYMENT_DECLINED', 'PAYMENT_ERROR']

// Misma validación de forma que orderApi.ts (duplicada a propósito: cada
// servicio Client valida su propia respuesta, sin depender de internals del otro).
/** Comprueba estructura, moneda y estados de la Order recibida antes de aceptar el resultado de pago. */
function isOrder(value: unknown): value is Order {
  if (!isRecord(value) || !isRecord(value.buyer) || !isRecord(value.delivery) || !isRecord(value.totals)) return false
  /** Comprueba que el valor recibido sea texto no vacío después de recortar espacios. */
  const text = (v: unknown) => typeof v === 'string' && v.trim().length > 0
  /** Comprueba que el valor recibido sea un importe numérico finito y no negativo. */
  const money = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v >= 0
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

/** Valida estructura y coherencia del resultado, incluyendo la Order y el escenario esperados. */
function isPaymentResult(value: unknown, orderId: string, scenario: PaymentScenario): value is PaymentResult {
  return isRecord(value)
    && SCENARIOS.includes(value.result as PaymentScenario)
    && typeof value.processedAt === 'string' && Number.isFinite(Date.parse(value.processedAt))
    && isOrder(value.order)
    && value.order.id === orderId
    && value.result === scenario
    && (value.result === 'PAYMENT_APPROVED'
      ? value.order.orderStatus === 'CONFIRMED' && value.order.paymentStatus === 'APPROVED'
      : value.order.orderStatus === 'PENDING'
        && value.order.paymentStatus === (value.result === 'PAYMENT_DECLINED' ? 'DECLINED' : 'ERROR'))
}

/** Envía escenario y clave para la Order indicada; devuelve únicamente un resultado validado y coherente. */
async function processPayment(orderId: string, request: ProcessPaymentRequest): Promise<PaymentResult> {
  const payload: ProcessPaymentRequest = { scenario: request.scenario, idempotencyKey: request.idempotencyKey }
  const response = await fetch(`${API_BASE_URL}/api/orders/${encodeURIComponent(orderId)}/payment`, {
    method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify(payload), signal: AbortSignal.timeout(20000),
  })
  const body: unknown = await response.json().catch(() => null)
  if (response.status !== 200 && response.status !== 201) {
    const code = isRecord(body) && isRecord(body.error) ? body.error.code : undefined
    // Códigos que el Server puede devolver de forma conocida para este endpoint.
    const known = ['ORDER_NOT_FOUND', 'ORDER_ALREADY_CONFIRMED', 'PAYMENT_IN_PROGRESS', 'INVALID_PAYMENT_SCENARIO', 'CHECKOUT_VALIDATION_ERROR']
    // "conclusive" = sabemos con certeza qué pasó (no hace falta reintentar con la misma key a ciegas).
    throw new PaymentApiError(known.includes(String(code)) ? code as ApiErrorResponse['error']['code'] : 'UNEXPECTED_ERROR', [400, 404, 409, 422].includes(response.status))
  }
  if (!isPaymentResult(body, orderId, payload.scenario)) throw new PaymentApiError('UNEXPECTED_ERROR', false)
  return body
}

export const paymentApi = { processPayment }

/** Convierte errores de pago en un mensaje público para la recuperación del intento. */
export function paymentErrorMessage(error: unknown): string {
  if (error instanceof PaymentApiError) {
    if (error.code === 'ORDER_NOT_FOUND') return 'No encontramos la orden asociada a este pago. Vuelve al carrito e intenta de nuevo.'
    if (error.code === 'ORDER_ALREADY_CONFIRMED') return 'Esta orden ya fue confirmada; no es necesario procesar otro pago.'
    if (error.code === 'PAYMENT_IN_PROGRESS') return 'Ya hay un pago en proceso para esta orden. Espera un momento.'
    if (error.code === 'INVALID_PAYMENT_SCENARIO') return 'Selecciona un escenario de pago válido.'
  }
  return 'Ocurrió un problema inesperado. Inténtalo nuevamente.'
}
