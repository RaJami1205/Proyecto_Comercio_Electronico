/** Validación de filtros y DTO resumido de Admin Orders (CN-66), sin IO ni recálculo de importes. */
import type { AdminOrderEntry, AdminOrderFilters, AdminOrderSort, AdminOrderSummary } from '../types/adminOrder.js'
import { OrderError } from './orderError.js'

export const ADMIN_ORDERS_DEFAULT_PAGE_SIZE = 20
export const ADMIN_ORDERS_MAX_PAGE_SIZE = 50
export const ADMIN_ORDERS_MAX_PAGE = 10000

const USER_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/
const allowed = {
  customerRole: ['B2C', 'B2B'],
  branchId: ['san_jose', 'alajuela', 'cartago', 'heredia'],
  orderStatus: ['PENDING', 'CONFIRMED'],
  paymentStatus: ['PENDING', 'APPROVED', 'DECLINED', 'ERROR'],
  sort: ['newest', 'oldest'],
} as const

export interface AdminOrderQuery {
  q: string
  filters: AdminOrderFilters
  sort: AdminOrderSort
  page: number
  pageSize: number
  offset: number
}

function invalid(field: string): OrderError {
  return new OrderError(400, 'INVALID_ORDER_FILTER', `El filtro ${field} no es válido.`)
}

/** Un valor repetido o no textual se rechaza en lugar de elegir uno arbitrariamente. */
function single(value: unknown, field: string): string | undefined {
  if (value === undefined || value === '') return undefined
  if (typeof value !== 'string') throw invalid(field)
  return value.trim() || undefined
}

function oneOf<T extends string>(value: unknown, values: readonly T[], field: string): T | undefined {
  const text = single(value, field)
  if (text === undefined) return undefined
  if (!(values as readonly string[]).includes(text)) throw invalid(field)
  return text as T
}

function positiveInteger(value: unknown, field: string, fallback: number, maximum: number): number {
  const text = single(value, field)
  if (text === undefined) return fallback
  if (!/^[1-9][0-9]{0,8}$/.test(text) || Number(text) > maximum) throw invalid(field)
  return Number(text)
}

function text(value: unknown, field: string, pattern: RegExp): string | undefined {
  const result = single(value, field)
  if (result !== undefined && !pattern.test(result)) throw invalid(field)
  return result
}

/** Valida cada query parameter; valores desconocidos responden INVALID_ORDER_FILTER. */
export function parseAdminOrderQuery(query: Record<string, unknown>): AdminOrderQuery {
  const page = positiveInteger(query.page, 'page', 1, ADMIN_ORDERS_MAX_PAGE)
  const pageSize = positiveInteger(query.pageSize, 'pageSize', ADMIN_ORDERS_DEFAULT_PAGE_SIZE, ADMIN_ORDERS_MAX_PAGE_SIZE)
  const filters: AdminOrderFilters = {
    orderId: text(query.orderId, 'orderId', /^[^\s]{1,200}$/),
    orderNumber: text(query.orderNumber, 'orderNumber', /^[A-Za-z0-9-]{1,80}$/),
    userId: text(query.userId, 'userId', USER_ID_PATTERN),
    customerRole: oneOf(query.customerRole, allowed.customerRole, 'customerRole'),
    branchId: oneOf(query.branchId, allowed.branchId, 'branchId'),
    orderStatus: oneOf(query.orderStatus, allowed.orderStatus, 'orderStatus'),
    paymentStatus: oneOf(query.paymentStatus, allowed.paymentStatus, 'paymentStatus'),
  }
  for (const key of Object.keys(filters) as (keyof AdminOrderFilters)[]) if (filters[key] === undefined) delete filters[key]
  const q = single(query.q, 'q') ?? ''
  if (q.length > 80) throw invalid('q')
  return { q, filters, sort: oneOf(query.sort, allowed.sort, 'sort') ?? 'newest', page, pageSize, offset: (page - 1) * pageSize }
}

/** Copia identidad, sucursal, importes y estados del snapshot persistido; nunca consulta el catálogo. */
export function toAdminOrderSummary({ order, owner }: AdminOrderEntry): AdminOrderSummary {
  return {
    id: order.id, orderNumber: order.orderNumber, createdAt: order.createdAt,
    contractVersion: order.contractVersion === 2 ? 2 : 1,
    userId: owner.userId, displayName: owner.displayName, customerRole: owner.customerRole,
    company: owner.customerRole === 'B2B' && owner.company ? { id: owner.company.id, name: owner.company.name } : null,
    branchId: order.commercial?.branchId ?? null,
    total: order.totals.total, currency: order.currency,
    orderStatus: order.orderStatus, paymentStatus: order.paymentStatus,
  }
}

/** Mismo predicado que aplica PostgreSQL, para el almacenamiento In-Memory. */
export function matchesAdminFilters({ order, owner }: AdminOrderEntry, filters: AdminOrderFilters): boolean {
  return (filters.orderId === undefined || order.id === filters.orderId)
    && (filters.orderNumber === undefined || order.orderNumber.toUpperCase() === filters.orderNumber.toUpperCase())
    && (filters.userId === undefined || owner.userId === filters.userId)
    && (filters.customerRole === undefined || owner.customerRole === filters.customerRole)
    && (filters.branchId === undefined || order.commercial?.branchId === filters.branchId)
    && (filters.orderStatus === undefined || order.orderStatus === filters.orderStatus)
    && (filters.paymentStatus === undefined || order.paymentStatus === filters.paymentStatus)
}
