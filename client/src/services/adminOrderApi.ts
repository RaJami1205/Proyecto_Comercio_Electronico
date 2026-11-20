/**
 * Consulta administrativa global de Orders (CN-66). El Server aplica RBAC; el Client envía la identidad activa,
 * valida cada respuesta desde unknown y nunca persiste Orders. Solo usa GET.
 */
import type { AdminOrderFilters, AdminOrderPage, AdminOrderSummary } from '../types/adminOrder'
import { BRANCH_IDS } from '../types/branch'

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL?.trim() || '').replace(/\/+$/, '')
export const ADMIN_ORDERS_PAGE_SIZE = 20

/** search-unavailable: el índice orders no responde; el listado sin texto sigue disponible. */
export type AdminOrderErrorKind = 'session' | 'forbidden' | 'invalid-filter' | 'search-unavailable' | 'unavailable'

export class AdminOrderApiError extends Error {
  readonly kind: AdminOrderErrorKind
  constructor(kind: AdminOrderErrorKind) {
    super('No se pudieron consultar las órdenes administrativas.')
    this.name = 'AdminOrderApiError'
    this.kind = kind
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
const text = (value: unknown) => typeof value === 'string' && value.trim().length > 0
const count = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
const statusPair = (orderStatus: unknown, paymentStatus: unknown) =>
  (orderStatus === 'CONFIRMED' && paymentStatus === 'APPROVED')
  || (orderStatus === 'PENDING' && (paymentStatus === 'PENDING' || paymentStatus === 'DECLINED' || paymentStatus === 'ERROR'))

/** Exige coherencia entre rol, empresa y sucursal; las Orders V1 no registran sucursal. */
function isSummary(value: unknown): value is AdminOrderSummary {
  if (!isRecord(value)) return false
  const company = value.company
  return text(value.id) && text(value.orderNumber) && typeof value.createdAt === 'string' && Number.isFinite(Date.parse(value.createdAt))
    && (value.contractVersion === 1 || value.contractVersion === 2)
    && (value.userId === null || text(value.userId)) && (value.displayName === null || typeof value.displayName === 'string')
    && (value.customerRole === null || value.customerRole === 'B2C' || value.customerRole === 'B2B')
    && (company === null || (value.customerRole === 'B2B' && isRecord(company) && text(company.id) && text(company.name)))
    && (value.branchId === null || (typeof value.branchId === 'string' && (BRANCH_IDS as readonly string[]).includes(value.branchId)))
    && (value.contractVersion === 1 || value.branchId !== null)
    && typeof value.total === 'number' && Number.isFinite(value.total) && value.total >= 0 && value.currency === 'CRC'
    && statusPair(value.orderStatus, value.paymentStatus)
    && (value.indexOutdated === undefined || typeof value.indexOutdated === 'boolean')
}

function isPage(value: unknown, page: number): value is AdminOrderPage {
  return isRecord(value) && Array.isArray(value.orders) && value.orders.every(isSummary)
    && value.page === page && value.pageSize === ADMIN_ORDERS_PAGE_SIZE && value.orders.length <= ADMIN_ORDERS_PAGE_SIZE
    && count(value.total) && typeof value.hasMore === 'boolean' && (value.source === 'postgresql' || value.source === 'algolia')
    && (value.pendingIndexOrders === null || count(value.pendingIndexOrders))
    && (value.missingFromStore === undefined || count(value.missingFromStore))
    && new Set(value.orders.map(order => (order as AdminOrderSummary).id)).size === value.orders.length
}

/** Omite filtros vacíos; q y orderNumber son excluyentes y la búsqueda por texto siempre es por fecha descendente. */
export function adminOrderQuery(filters: AdminOrderFilters): string {
  const query = new URLSearchParams()
  const q = filters.q.trim()
  if (q) query.set('q', q)
  else if (filters.orderNumber.trim()) query.set('orderNumber', filters.orderNumber.trim())
  if (filters.userId.trim()) query.set('userId', filters.userId.trim())
  for (const key of ['customerRole', 'branchId', 'orderStatus', 'paymentStatus'] as const) if (filters[key]) query.set(key, filters[key])
  if (!q && filters.sort !== 'newest') query.set('sort', filters.sort)
  query.set('page', String(filters.page))
  query.set('pageSize', String(ADMIN_ORDERS_PAGE_SIZE))
  return query.toString()
}

async function list(userId: string, filters: AdminOrderFilters, signal?: AbortSignal): Promise<AdminOrderPage> {
  return request(userId, adminOrderQuery(filters), filters.page, signal)
}

/** Resumen administrativo de una Order (identidad del comprador); null si no existe en la persistencia. */
async function getSummary(userId: string, orderId: string, signal?: AbortSignal): Promise<AdminOrderSummary | null> {
  const query = new URLSearchParams({ orderId, page: '1', pageSize: String(ADMIN_ORDERS_PAGE_SIZE) })
  const result = await request(userId, query.toString(), 1, signal)
  const summary = result.orders[0]
  if (result.orders.length > 1 || (summary && summary.id !== orderId)) throw new AdminOrderApiError('unavailable')
  return summary ?? null
}

async function request(userId: string, query: string, page: number, signal?: AbortSignal): Promise<AdminOrderPage> {
  let response: Response
  try {
    response = await fetch(API_BASE_URL + '/api/v2/admin/orders?' + query, {
      method: 'GET', headers: { Accept: 'application/json', 'X-CiberNova-User-Id': userId }, signal,
    })
  } catch (error) {
    if (signal?.aborted) throw error
    throw new AdminOrderApiError('unavailable')
  }
  const body: unknown = await response.json().catch(() => null)
  if (response.status === 200) {
    if (!isPage(body, page)) throw new AdminOrderApiError('unavailable')
    return body
  }
  const code = isRecord(body) && isRecord(body.error) ? body.error.code : undefined
  if (response.status === 401 || code === 'USER_NOT_FOUND' || code === 'INVALID_USER_ID') throw new AdminOrderApiError('session')
  if (code === 'INVALID_ORDER_FILTER') throw new AdminOrderApiError('invalid-filter')
  if (code === 'ORDER_SEARCH_UNAVAILABLE') throw new AdminOrderApiError('search-unavailable')
  if (response.status === 403) throw new AdminOrderApiError('forbidden')
  throw new AdminOrderApiError('unavailable')
}

export const adminOrderApi = { list, getSummary }
