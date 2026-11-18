/** Proyección resumida de una Order para el índice Algolia orders; PostgreSQL sigue siendo la fuente autoritativa. */
import type { BranchId } from './branch.js'
import type { Order, OrderStatus, PaymentStatus } from './order.js'
import type { Company } from './user.js'

/** Sin Buyer, Delivery, productos ni Payment: solo los datos administrativos necesarios para buscar y filtrar. */
export interface OrderIndexRecord {
  objectID: string
  orderNumber: string
  userId: string
  customerRole: 'B2C' | 'B2B'
  /** Las Orders V1 no registraban sucursal; se indexa null en lugar de inventarla. */
  branchId: BranchId | null
  createdAt: string
  /** Segundos Unix de createdAt para filtros numéricos por rango de fechas. */
  createdAtTimestamp: number
  orderStatus: OrderStatus
  paymentStatus: PaymentStatus
  total: number
  currency: 'CRC'
  indexVersion: number
  contractVersion: 1 | 2
  /** Solo B2B: identificación empresarial para consultas administrativas. */
  company?: Company
}

/** Lectura persistida que necesita el mapper, incluida la identidad histórica que el DTO V1 no expone. */
export interface OrderIndexSource {
  order: Order
  ownerUserId: string
  customerRole: string
  company?: Company
  indexVersion: number
}
