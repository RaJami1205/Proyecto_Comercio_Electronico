/** Envía solicitudes de creación de Order V2 y valida las respuestas y errores recibidos por HTTP. */
import type { ApiErrorResponse } from '../types/apiError'
import type { CreateOrderRequest, Order } from '../types/order'
import { authorizationErrorMessage, identityErrorCodes, isAuthorizationRejection } from '../utils/authorizationErrors'

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL?.trim() || '').replace(/\/+$/, '')

export class OrderApiError extends Error {
  readonly code: ApiErrorResponse['error']['code']
  readonly conclusive: boolean
  readonly authorizationDenied: boolean
  readonly fieldErrors?: Record<string, string>

  /** Conserva código, certeza del fallo y errores de campo para orientar la recuperación de Checkout. */
  constructor(code: ApiErrorResponse['error']['code'], conclusive: boolean, fieldErrors?: Record<string, string>) {
    super('No se pudo crear la orden.')
    this.name = 'OrderApiError'
    this.code = code
    this.conclusive = conclusive
    // INVALID_B2B_DATA con fieldErrors.items describe un producto, no la identidad del comprador.
    this.authorizationDenied = conclusive && isAuthorizationRejection(code)
      && !(code === 'INVALID_B2B_DATA' && fieldErrors !== undefined && Object.hasOwn(fieldErrors, 'items'))
    this.fieldErrors = fieldErrors
  }
}

/** Categorías funcionales de Checkout; agrupan los códigos reales del Server sin exponer detalles internos. */
export type CheckoutErrorKind =
  | 'SESSION_REQUIRED' | 'FORBIDDEN' | 'INVALID_BRANCH' | 'PRODUCT_NOT_FOUND' | 'BELOW_MINIMUM_QUANTITY'
  | 'INSUFFICIENT_BRANCH_STOCK' | 'INVALID_COMMERCIAL_PRICE' | 'IDEMPOTENCY_CONFLICT' | 'CLIENT_UPDATE_REQUIRED'
  | 'SERVICE_UNAVAILABLE' | 'BUYER' | 'DELIVERY' | 'TERMS' | 'UNKNOWN'

/** Lugar donde el usuario puede corregir la compra sin reiniciar todo el Checkout. */
export type CheckoutRecovery = 'cart' | 'buyer' | 'delivery' | 'review' | 'retry' | 'none'

const fieldKeys = (fieldErrors?: Record<string, string>) => Object.keys(fieldErrors ?? {})
const hasField = (fieldErrors: Record<string, string> | undefined, prefix: string) =>
  fieldKeys(fieldErrors).some(key => key === prefix || key.startsWith(prefix + '.'))

/** Traduce un fallo de creación a su categoría y destino de corrección. */
export function classifyOrderFailure(error: unknown): { kind: CheckoutErrorKind; recovery: CheckoutRecovery } {
  if (!(error instanceof OrderApiError)) return { kind: 'SERVICE_UNAVAILABLE', recovery: 'retry' }
  const { code, fieldErrors, conclusive } = error
  if (!conclusive) return { kind: 'SERVICE_UNAVAILABLE', recovery: 'retry' }
  if (code === 'IDENTITY_REQUIRED' || code === 'INVALID_USER_ID' || code === 'USER_NOT_FOUND') return { kind: 'SESSION_REQUIRED', recovery: 'none' }
  if (code === 'INVALID_B2B_DATA' && hasField(fieldErrors, 'items')) return { kind: 'INVALID_COMMERCIAL_PRICE', recovery: 'cart' }
  if (error.authorizationDenied) return { kind: 'FORBIDDEN', recovery: 'none' }
  if (code === 'ORDER_CONTRACT_DEPRECATED') return { kind: 'CLIENT_UPDATE_REQUIRED', recovery: 'none' }
  if (code === 'INVALID_BRANCH_ID' || hasField(fieldErrors, 'branchId')) return { kind: 'INVALID_BRANCH', recovery: 'cart' }
  if (code === 'PRODUCT_NOT_FOUND' || code === 'EMPTY_CART') return { kind: 'PRODUCT_NOT_FOUND', recovery: 'cart' }
  if (code === 'INVALID_MOQ' || code === 'INVALID_QUANTITY') return { kind: 'BELOW_MINIMUM_QUANTITY', recovery: 'cart' }
  if (code === 'INSUFFICIENT_INVENTORY' || code === 'INVENTORY_UNAVAILABLE') return { kind: 'INSUFFICIENT_BRANCH_STOCK', recovery: 'cart' }
  if (code === 'INVALID_PRODUCT_PRICE' || code === 'B2B_NOT_AVAILABLE') return { kind: 'INVALID_COMMERCIAL_PRICE', recovery: 'cart' }
  if (code === 'CHECKOUT_VALIDATION_ERROR') {
    if (hasField(fieldErrors, 'idempotencyKey')) return { kind: 'IDEMPOTENCY_CONFLICT', recovery: 'review' }
    if (hasField(fieldErrors, 'financialExpectation')) return { kind: 'INVALID_COMMERCIAL_PRICE', recovery: 'cart' }
    if (hasField(fieldErrors, 'termsAcceptance')) return { kind: 'TERMS', recovery: 'review' }
    if (hasField(fieldErrors, 'buyer')) return { kind: 'BUYER', recovery: 'buyer' }
    if (hasField(fieldErrors, 'delivery')) return { kind: 'DELIVERY', recovery: 'delivery' }
    if (hasField(fieldErrors, 'items')) return { kind: 'INSUFFICIENT_BRANCH_STOCK', recovery: 'cart' }
  }
  return { kind: 'UNKNOWN', recovery: 'review' }
}

/** Comprueba que el valor desconocido sea un objeto no nulo y no un arreglo. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
/** Valida estructura, moneda, estados y metadata obligatoria; una versión histórica no se compara con TermsPage. */
function isOrder(value: unknown): value is Order {
  if (!isRecord(value) || !isRecord(value.buyer) || !isRecord(value.delivery) || !isRecord(value.totals)
    || !isRecord(value.termsAcceptance)) return false
  /** Comprueba que el valor recibido sea texto no vacío después de recortar espacios. */
  const text = (value: unknown) => typeof value === 'string' && value.trim().length > 0
  /** Comprueba que el valor recibido sea un importe numérico finito y no negativo. */
  const money = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0
  const terms = value.termsAcceptance
  // El Server emite ISO canónico; no aceptar fechas locales, parciales o normalizadas.
  const acceptedAt = terms.acceptedAt
  if (terms.accepted !== true || !text(terms.version) || typeof acceptedAt !== 'string'
    || !Number.isFinite(Date.parse(acceptedAt)) || new Date(acceptedAt).toISOString() !== acceptedAt) return false
  const commercial = value.commercial
  if (commercial !== undefined && !isCommercialSnapshot(commercial)) return false
  if (value.contractVersion !== undefined && value.contractVersion !== 1 && value.contractVersion !== 2) return false
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
      && typeof item.quantity === 'number' && Number.isSafeInteger(item.quantity) && item.quantity > 0 && money(item.lineSubtotal)
      && (item.minOrderQuantity === undefined || (typeof item.minOrderQuantity === 'number' && Number.isSafeInteger(item.minOrderQuantity) && item.minOrderQuantity >= 1)))
}

/** Valida el contexto comercial histórico emitido por el Server para Orders V2. */
function isCommercialSnapshot(value: unknown): value is NonNullable<Order['commercial']> {
  if (!isRecord(value)) return false
  const text = (candidate: unknown) => typeof candidate === 'string' && candidate.trim().length > 0
  const company = value.company
  const validCompany = company === undefined || (isRecord(company) && text(company.id) && text(company.name))
  return text(value.userId) && (value.customerRole === 'B2C' || value.customerRole === 'B2B')
    && text(value.branchId)
    && (value.pricingType === (value.customerRole === 'B2B' ? 'WHOLESALE' : 'RETAIL'))
    && text(value.policyVersion) && validCompany && (value.customerRole === 'B2B') === (company !== undefined)
}

/** Una Order V2 debe pertenecer al usuario y a la sucursal validada del intento; otra respuesta no se acepta como resultado. */
function matchesAttempt(order: Order, request: CreateOrderRequest, userId: string): boolean {
  return order.contractVersion === 2 && order.commercial !== undefined
    && order.commercial.userId === userId && order.commercial.branchId === request.branchId
}

/**
 * Envía datos, referencias, sucursal, clave, consentimiento y expectativas financieras a Orders V2.
 * Nunca envía rol, precios unitarios, impuestos ni totales como datos autoritativos.
 * Una respuesta inválida o de otro usuario/sucursal mantiene incierto el resultado de creación.
 */
async function createOrder(request: CreateOrderRequest, userId: string): Promise<Order> {
  const expectation = request.financialExpectation
  const payload: CreateOrderRequest = {
    buyer: request.buyer, delivery: request.delivery,
    items: request.items.map(({ productId, quantity }) => ({ productId, quantity })),
    idempotencyKey: request.idempotencyKey,
    termsAcceptance: { accepted: request.termsAcceptance.accepted, version: request.termsAcceptance.version },
    ...(request.branchId !== undefined ? { branchId: request.branchId } : {}),
    ...(expectation ? { financialExpectation: { subtotal: expectation.subtotal, tax: expectation.tax, shipping: expectation.shipping, total: expectation.total } } : {}),
  }
  const response = await fetch(API_BASE_URL + '/api/v2/orders', {
    method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-CiberNova-User-Id': userId },
    body: JSON.stringify(payload), signal: AbortSignal.timeout(20000),
  })
  const body: unknown = await response.json().catch(() => null)
  
  // Acepta respuestas de creación o replay; ambas deben contener una Order válida.
  if (response.status !== 201 && response.status !== 200) {
    const code = isRecord(body) && isRecord(body.error) ? body.error.code : undefined
    const fieldErrors = isRecord(body) && isRecord(body.error) && isRecord(body.error.fieldErrors) 
      ? body.error.fieldErrors as Record<string, string> 
      : undefined

    const known = ['CHECKOUT_VALIDATION_ERROR', 'EMPTY_CART', 'PRODUCT_NOT_FOUND', 'ORDER_NOT_FOUND', 'INVALID_BRANCH_ID',
      'INVALID_PRODUCT_PRICE', 'B2B_NOT_AVAILABLE', 'INVALID_MOQ', 'INVALID_QUANTITY', 'INVENTORY_UNAVAILABLE',
      'INSUFFICIENT_INVENTORY', 'ORDER_CONTRACT_DEPRECATED', ...identityErrorCodes]
    // Un 409 solo es concluyente cuando el Server rechaza la clave o los importes antes de crear la Order.
    const conclusiveConflict = response.status === 409 && fieldErrors !== undefined
      && Object.keys(fieldErrors).some(key => key === 'idempotencyKey' || key.startsWith('financialExpectation'))
    const outcomeUnknown = isRecord(body) && isRecord(body.error) && body.error.outcome === 'unknown'
    throw new OrderApiError(
      known.includes(String(code)) ? code as ApiErrorResponse['error']['code'] : 'UNEXPECTED_ERROR',
      !outcomeUnknown && ([400, 401, 403, 404, 410, 413, 422].includes(response.status) || conclusiveConflict),
      fieldErrors
    )
  }

  if (!isOrder(body) || !matchesAttempt(body, payload, userId)) throw new OrderApiError('UNEXPECTED_ERROR', false)
  return body
}
export const orderApi = { createOrder }

/** Convierte un error de creación en un mensaje público sin exponer detalles internos. */
export function orderErrorMessage(error: unknown): string {
  if (error instanceof OrderApiError) {
    const identityMessage = authorizationErrorMessage(error.code)
    if (identityMessage) return identityMessage
    if (error.code === 'ORDER_NOT_FOUND') return 'No se puede verificar la propiedad de esta orden. Conserva el contexto si hubo una solicitud anterior sin respuesta.'
    if (error.code === 'PRODUCT_NOT_FOUND') return 'Uno de los productos ya no esta disponible. Revisa tu carrito antes de continuar.'
    if (error.code === 'EMPTY_CART') return 'Agrega productos al carrito para continuar.'
    if (error.code === 'INVALID_BRANCH_ID') return 'La sucursal seleccionada no es válida. Elige otra sucursal en el carrito.'
    if (error.code === 'INVALID_MOQ' || error.code === 'INVALID_QUANTITY') return 'Una cantidad no cumple el mínimo de compra. Ajusta las cantidades en el carrito.'
    if (error.code === 'INSUFFICIENT_INVENTORY' || error.code === 'INVENTORY_UNAVAILABLE') return 'La sucursal no tiene existencias suficientes. Corrige la cantidad o elige otra sucursal.'
    if (error.code === 'INVALID_PRODUCT_PRICE' || error.code === 'B2B_NOT_AVAILABLE') return 'Un producto no tiene un precio comercial vigente para tu cuenta. Revisa tu carrito.'
    if (error.code === 'ORDER_CONTRACT_DEPRECATED') return 'Esta versión de la tienda ya no puede crear órdenes. Recarga la página para continuar.'
    if (error.code === 'CHECKOUT_VALIDATION_ERROR') {
      const { kind } = classifyOrderFailure(error)
      if (kind === 'IDEMPOTENCY_CONFLICT') return 'La solicitud no coincide con el intento original. Revisa tu compra antes de iniciar un nuevo intento.'
      if (kind === 'INVALID_COMMERCIAL_PRICE') return 'Los importes cambiaron desde que revisaste tu carrito. Actualiza el carrito para ver los precios vigentes.'
      if (kind === 'DELIVERY') return 'Revisa los datos de entrega. Corrige los campos para continuar.'
      if (kind === 'INVALID_BRANCH') return 'Selecciona una sucursal válida en el carrito para continuar.'
      if (kind === 'INSUFFICIENT_BRANCH_STOCK') return 'Revisa la disponibilidad y las cantidades de los productos en el carrito.'
      return 'Revisa los datos del comprador y la entrega. Corrige los campos para continuar.'
    }
  }
  return 'Ocurrio un problema inesperado. Intentalo nuevamente.'
}
