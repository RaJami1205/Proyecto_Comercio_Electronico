/** Contratos Read-Only de la consulta administrativa global de Orders (CN-66). */
import type { BranchId } from './branch.js'
import type { Order, OrderStatus, PaymentStatus } from './order.js'
import type { Company } from './user.js'

/** Identidad histórica del comprador guardada con la Order; null solo en fixtures legacy sin propietario. */
export interface AdminOrderOwner {
  userId: string | null
  displayName: string | null
  customerRole: 'B2C' | 'B2B' | null
  company?: Company
}

/** Order persistida junto con su propietario, tal como la devuelve el store. */
export interface AdminOrderEntry {
  order: Order
  owner: AdminOrderOwner
}

/** Fila del listado: sin Buyer, Delivery ni productos. */
export interface AdminOrderSummary {
  id: string
  orderNumber: string
  createdAt: string
  contractVersion: 1 | 2
  userId: string | null
  displayName: string | null
  customerRole: 'B2C' | 'B2B' | null
  company: Company | null
  branchId: BranchId | null
  total: number
  currency: 'CRC'
  orderStatus: OrderStatus
  paymentStatus: PaymentStatus
  /** Solo en búsquedas: el índice tenía otro estado y se muestra el actual del Store seleccionado. */
  indexOutdated?: boolean
}

export interface AdminOrderFilters {
  orderId?: string
  orderNumber?: string
  userId?: string
  customerRole?: 'B2C' | 'B2B'
  branchId?: BranchId
  orderStatus?: OrderStatus
  paymentStatus?: PaymentStatus
}

export type AdminOrderSort = 'newest' | 'oldest'

export interface AdminOrderPage {
  orders: AdminOrderSummary[]
  page: number
  pageSize: number
  total: number
  hasMore: boolean
  /** Proveedor de coincidencias: Repository efectivo en el listado, Algolia en Search; las Orders siempre se leen del Store. */
  source: 'memory' | 'postgresql' | 'algolia'
  /** Orders persistidas con revisiones pendientes de indexar; null si el almacenamiento no las registra. */
  pendingIndexOrders: number | null
  /** Coincidencias del índice que ya no existen en el Store seleccionado y se omitieron. */
  missingFromStore?: number
}
