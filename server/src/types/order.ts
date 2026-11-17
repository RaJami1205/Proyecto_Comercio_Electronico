/** Define solicitudes de creación y snapshots de Order con productos, importes y estados transaccionales. */
import type { BuyerInfo, DeliveryInfo } from './checkout.js'
import type { BranchId } from './branch.js'
import type { Company, UserRole } from './user.js'
import type { PricingType } from './commercial.js'

export interface CreateOrderItemRequest {
  productId: string
  quantity: number
}

/** Declaración recibida del navegador; el validador exige accepted exactamente true. */
export interface TermsAcceptanceRequest {
  accepted: boolean
  version: string
}

/** Solicitud con datos, referencias y consentimiento; no contiene precios ni estados confiables. */
export interface CreateOrderRequest {
  buyer: BuyerInfo
  delivery: DeliveryInfo
  items: CreateOrderItemRequest[]
  idempotencyKey: string
  termsAcceptance: TermsAcceptanceRequest
  /** Requerido por V2; V1 se conserva solo para validación/replay histórico. */
  branchId?: BranchId
  financialExpectation?: Partial<OrderTotals>
}

/** Snapshot de producto con precio y subtotal determinados por el Server. */
export interface OrderItem {
  productId: string
  name: string
  image: string
  unitPrice: number
  quantity: number
  lineSubtotal: number
  /** Condición comercial histórica por producto; ausente en Orders V1. */
  minOrderQuantity?: number
}

export interface OrderTotals {
  subtotal: number
  tax: number
  shipping: number
  total: number
}

export type OrderStatus =
  | 'PENDING'
  | 'CONFIRMED'

export type PaymentStatus =
  | 'PENDING'
  | 'APPROVED'
  | 'DECLINED'
  | 'ERROR'

/** Consentimiento validado cuya fecha genera buildOrder, nunca el navegador. */
export interface OrderTermsAcceptance {
  accepted: true
  version: string
  acceptedAt: string
}

/** Snapshot autoritativo de la compra, independiente del Cart editable. */
export interface Order {
  id: string
  orderNumber: string
  createdAt: string
  buyer: BuyerInfo
  delivery: DeliveryInfo
  items: OrderItem[]
  totals: OrderTotals
  currency: 'CRC'
  orderStatus: OrderStatus
  paymentStatus: PaymentStatus
  termsAcceptance: OrderTermsAcceptance
  contractVersion?: 1 | 2
  commercial?: OrderCommercialSnapshot
}

export interface OrderCommercialSnapshot {
  userId: string
  customerRole: Extract<UserRole, 'B2C' | 'B2B'>
  company?: Company
  branchId: BranchId
  pricingType: PricingType
  policyVersion: string
}
