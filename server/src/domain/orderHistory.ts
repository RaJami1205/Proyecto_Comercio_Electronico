/** Paginación y DTO resumido de Order History (CN-64), sin IO ni recálculo de importes. */
import type { Order, OrderSummary } from '../types/order.js'

export const ORDER_HISTORY_DEFAULT_PAGE_SIZE = 10
export const ORDER_HISTORY_MAX_PAGE_SIZE = 50
/** Límite defensivo del offset; un historial real no alcanza este volumen. */
export const ORDER_HISTORY_MAX_PAGE = 10000

export interface OrderHistoryQuery {
  page: number
  pageSize: number
  offset: number
}

/** Misma convención que el catálogo: valores ausentes o inválidos usan el default y el tamaño se limita al máximo. */
function positiveInteger(value: unknown, fallback: number, maximum: number): number {
  if (typeof value !== 'string' || !/^[0-9]{1,9}$/.test(value)) return fallback
  const parsed = Number(value)
  return parsed < 1 ? fallback : Math.min(parsed, maximum)
}

export function parseOrderHistoryQuery(query: { page?: unknown; pageSize?: unknown }): OrderHistoryQuery {
  const page = positiveInteger(query.page, 1, ORDER_HISTORY_MAX_PAGE)
  const pageSize = positiveInteger(query.pageSize, ORDER_HISTORY_DEFAULT_PAGE_SIZE, ORDER_HISTORY_MAX_PAGE_SIZE)
  return { page, pageSize, offset: (page - 1) * pageSize }
}

/** Copia los campos del snapshot persistido; nunca consulta el catálogo ni completa datos históricos ausentes. */
export function toOrderSummary(order: Order): OrderSummary {
  return {
    id: order.id, orderNumber: order.orderNumber, createdAt: order.createdAt,
    contractVersion: order.contractVersion === 2 ? 2 : 1,
    branchId: order.commercial?.branchId ?? null,
    total: order.totals.total, currency: order.currency,
    orderStatus: order.orderStatus, paymentStatus: order.paymentStatus,
  }
}
