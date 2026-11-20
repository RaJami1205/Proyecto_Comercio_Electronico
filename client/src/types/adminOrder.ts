/** Contratos de la consulta administrativa global de Orders (CN-66), sincronizados con server/src/types/adminOrder.ts. */
import type { BranchId } from './branch'
import type { OrderStatus, PaymentStatus } from './order'
import type { Company } from './user'

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

export interface AdminOrderPage {
  orders: AdminOrderSummary[]
  page: number
  pageSize: number
  total: number
  hasMore: boolean
  /** Proveedor de coincidencias; source=algolia no identifica el motor que hidrata las Orders. */
  source: 'memory' | 'postgresql' | 'algolia'
  pendingIndexOrders: number | null
  missingFromStore?: number
}

/** Filtros de la vista; los vacíos no se envían. q usa el índice Algolia y orderNumber la persistencia. */
export interface AdminOrderFilters {
  q: string
  orderNumber: string
  userId: string
  customerRole: 'B2C' | 'B2B' | ''
  branchId: BranchId | ''
  orderStatus: OrderStatus | ''
  paymentStatus: PaymentStatus | ''
  sort: 'newest' | 'oldest'
  page: number
}
