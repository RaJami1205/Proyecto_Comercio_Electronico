/**
 * Consulta el historial propio y el detalle de Orders (CN-64). El Server decide la propiedad;
 * el Client solo envía la identidad activa y valida la forma de cada respuesta. Nunca persiste Orders.
 */
import type { Order, OrderHistoryPage, OrderSummary } from '../types/order'

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL?.trim() || '').replace(/\/+$/, '')
const BRANCHES = ['san_jose', 'alajuela', 'cartago', 'heredia']

/** session: elegir identidad, forbidden: rol sin acceso, not-found: inexistente o ajena, unavailable: reintentable. */
export type OrderHistoryErrorKind = 'session' | 'forbidden' | 'not-found' | 'unavailable'

export class OrderHistoryApiError extends Error {
  readonly kind: OrderHistoryErrorKind
  constructor(kind: OrderHistoryErrorKind) {
    super('No se pudo consultar el historial de órdenes.')
    this.name = 'OrderHistoryApiError'
    this.kind = kind
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
const text = (value: unknown) => typeof value === 'string' && value.trim().length > 0
const money = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0
const count = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
const date = (value: unknown) => typeof value === 'string' && Number.isFinite(Date.parse(value))
const statusPair = (orderStatus: unknown, paymentStatus: unknown) =>
  (orderStatus === 'CONFIRMED' && paymentStatus === 'APPROVED')
  || (orderStatus === 'PENDING' && (paymentStatus === 'PENDING' || paymentStatus === 'DECLINED' || paymentStatus === 'ERROR'))

function isSummary(value: unknown): value is OrderSummary {
  return isRecord(value) && text(value.id) && text(value.orderNumber) && date(value.createdAt)
    && (value.contractVersion === 1 || value.contractVersion === 2)
    && (value.branchId === null || (typeof value.branchId === 'string' && BRANCHES.includes(value.branchId)))
    && (value.contractVersion === 1 || value.branchId !== null)
    && money(value.total) && value.currency === 'CRC' && statusPair(value.orderStatus, value.paymentStatus)
}

function isHistoryPage(value: unknown, page: number, pageSize: number): value is OrderHistoryPage {
  return isRecord(value) && Array.isArray(value.orders) && value.orders.every(isSummary)
    && value.page === page && value.pageSize === pageSize && count(value.total) && typeof value.hasMore === 'boolean'
    && value.orders.length <= pageSize && new Set(value.orders.map(order => (order as OrderSummary).id)).size === value.orders.length
}

/** Valida el snapshot histórico; los campos comerciales son opcionales en Orders V1 y nunca se completan. */
function isOrderDetail(value: unknown, orderId: string, ownerId: string | null): value is Order {
  if (!isRecord(value) || value.id !== orderId || !isRecord(value.buyer) || !isRecord(value.delivery) || !isRecord(value.totals)
    || !isRecord(value.termsAcceptance)) return false
  const { buyer, delivery, totals, termsAcceptance: terms, commercial } = value
  if (commercial !== undefined) {
    if (!isRecord(commercial) || (ownerId !== null && commercial.userId !== ownerId) || (commercial.customerRole !== 'B2C' && commercial.customerRole !== 'B2B')
      || typeof commercial.branchId !== 'string' || !BRANCHES.includes(commercial.branchId)
      || (commercial.customerRole === 'B2B' && !(isRecord(commercial.company) && text(commercial.company.name)))) return false
  }
  return text(value.orderNumber) && date(value.createdAt) && value.currency === 'CRC' && statusPair(value.orderStatus, value.paymentStatus)
    && ['fullName', 'email', 'phone'].every(key => text(buyer[key]))
    && ['province', 'canton', 'address'].every(key => text(delivery[key]))
    && (delivery.additionalInfo === undefined || typeof delivery.additionalInfo === 'string')
    && ['subtotal', 'tax', 'shipping', 'total'].every(key => money(totals[key]))
    && terms.accepted === true && text(terms.version) && date(terms.acceptedAt)
    && Array.isArray(value.items) && value.items.length > 0 && value.items.every(item => isRecord(item)
      && text(item.productId) && text(item.name) && typeof item.image === 'string' && money(item.unitPrice) && money(item.lineSubtotal)
      && typeof item.quantity === 'number' && Number.isSafeInteger(item.quantity) && item.quantity > 0
      && (item.minOrderQuantity === undefined || (typeof item.minOrderQuantity === 'number' && Number.isSafeInteger(item.minOrderQuantity) && item.minOrderQuantity >= 1)))
}

/** Traduce el contrato HTTP a categorías de interfaz sin exponer mensajes internos del Server. */
async function request(path: string, userId: string, signal?: AbortSignal): Promise<unknown> {
  let response: Response
  try {
    response = await fetch(API_BASE_URL + path, {
      method: 'GET', headers: { Accept: 'application/json', 'X-CiberNova-User-Id': userId }, signal,
    })
  } catch (error) {
    if (signal?.aborted) throw error
    throw new OrderHistoryApiError('unavailable')
  }
  const body: unknown = await response.json().catch(() => null)
  if (response.status === 200) return body
  const code = isRecord(body) && isRecord(body.error) ? body.error.code : undefined
  if (response.status === 401 || code === 'USER_NOT_FOUND' || code === 'INVALID_USER_ID') throw new OrderHistoryApiError('session')
  if (code === 'ORDER_NOT_FOUND') throw new OrderHistoryApiError('not-found')
  if (response.status === 403 || response.status === 422) throw new OrderHistoryApiError('forbidden')
  throw new OrderHistoryApiError('unavailable')
}

async function listMine(userId: string, page: number, pageSize: number, signal?: AbortSignal): Promise<OrderHistoryPage> {
  const query = new URLSearchParams({ page: String(page), pageSize: String(pageSize) })
  const body = await request('/api/v2/orders/mine?' + query.toString(), userId, signal)
  if (!isHistoryPage(body, page, pageSize)) throw new OrderHistoryApiError('unavailable')
  return body
}

/** expectedOwnerId: propietario que debe registrar el contexto comercial; ADMIN (CN-66) indica el del listado administrativo o null. */
async function getOrder(userId: string, orderId: string, signal?: AbortSignal, expectedOwnerId: string | null = userId): Promise<Order> {
  const body = await request('/api/v2/orders/' + encodeURIComponent(orderId), userId, signal)
  if (!isOrderDetail(body, orderId, expectedOwnerId)) throw new OrderHistoryApiError('unavailable')
  return body
}

export const orderHistoryApi = { listMine, getOrder }
