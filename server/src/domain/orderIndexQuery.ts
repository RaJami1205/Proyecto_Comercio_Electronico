/** Settings y filtros del índice orders para futuras consultas administrativas, siempre ejecutadas desde Server. */
import type { BranchId } from '../types/branch.js'
import type { OrderStatus, PaymentStatus } from '../types/order.js'

/** Se aplica solo mediante el procedimiento de mantenimiento; no se modifica al sincronizar records. */
export const ORDER_INDEX_SETTINGS = Object.freeze({
  searchableAttributes: ['orderNumber', 'company.name'],
  attributesForFaceting: ['filterOnly(userId)', 'customerRole', 'branchId', 'orderStatus', 'paymentStatus',
    'filterOnly(company.id)', 'filterOnly(contractVersion)'],
  customRanking: ['desc(createdAtTimestamp)'],
})

export interface OrderIndexFilterQuery {
  userId?: string
  customerRole?: 'B2C' | 'B2B'
  branchId?: BranchId
  orderStatus?: OrderStatus
  paymentStatus?: PaymentStatus
  /** Límites inclusivos en ISO 8601. */
  createdFrom?: string
  createdTo?: string
}

const USER_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/
const allowed: Record<'customerRole' | 'branchId' | 'orderStatus' | 'paymentStatus', readonly string[]> = {
  customerRole: ['B2C', 'B2B'],
  branchId: ['san_jose', 'alajuela', 'cartago', 'heredia'],
  orderStatus: ['PENDING', 'CONFIRMED'],
  paymentStatus: ['PENDING', 'APPROVED', 'DECLINED', 'ERROR'],
}

/** Convierte una fecha ISO en segundos Unix o rechaza el filtro. */
function seconds(field: string, value: string): number {
  const time = Date.parse(value)
  if (!/^\d{4}-\d{2}-\d{2}/.test(value) || !Number.isFinite(time)) throw new RangeError(`Filtro inválido: ${field}.`)
  return Math.floor(time / 1000)
}

/** Valida cada valor contra su conjunto aprobado antes de construir la expresión, evitando inyección de filtros. */
export function buildOrderIndexFilters(query: OrderIndexFilterQuery): string {
  const filters: string[] = []
  if (query.userId !== undefined) {
    if (!USER_ID_PATTERN.test(query.userId)) throw new RangeError('Filtro inválido: userId.')
    filters.push(`userId:"${query.userId}"`)
  }
  for (const field of ['customerRole', 'branchId', 'orderStatus', 'paymentStatus'] as const) {
    const value = query[field]
    if (value === undefined) continue
    if (!allowed[field].includes(value)) throw new RangeError(`Filtro inválido: ${field}.`)
    filters.push(`${field}:"${value}"`)
  }
  if (query.createdFrom !== undefined) filters.push(`createdAtTimestamp >= ${seconds('createdFrom', query.createdFrom)}`)
  if (query.createdTo !== undefined) filters.push(`createdAtTimestamp <= ${seconds('createdTo', query.createdTo)}`)
  return filters.join(' AND ')
}
