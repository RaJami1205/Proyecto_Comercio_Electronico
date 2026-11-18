/** Define solicitudes de creación y snapshots de Order con productos, importes y estados transaccionales. */
import type { BuyerInfo, DeliveryInfo } from './checkout'
import type { BranchId } from './branch'
import type { PricingType } from './commercial'
import type { Company } from './user'

export interface CreateOrderItemRequest {
  productId: string
  quantity: number
}

/** Declaración capturada por Checkout; acceptedAt solo existe en el snapshot emitido por Server. */
export interface TermsAcceptanceRequest {
  readonly accepted: boolean
  readonly version: string
}

/** Importes estimados por el Client; el Server los compara y rechaza el intento si no coinciden. */
export type OrderFinancialExpectation = Readonly<OrderTotals>

/** Solicitud del navegador con datos, referencias y consentimiento; no aporta rol, precios ni estados confiables. */
export interface CreateOrderRequest {
  buyer: BuyerInfo
  delivery: DeliveryInfo
  items: CreateOrderItemRequest[]
  idempotencyKey: string
  termsAcceptance: TermsAcceptanceRequest
  /** Requerido por Orders V2: una única sucursal para todos los productos. */
  branchId?: BranchId
  financialExpectation?: OrderFinancialExpectation
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

/** Consentimiento validado por Server, con versión original y timestamp ISO conservados durante replay. */
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

/** Contexto comercial confirmado por el Server al crear la Order V2; no se recalcula con el catálogo actual. */
export interface OrderCommercialSnapshot {
  userId: string
  customerRole: 'B2C' | 'B2B'
  company?: Company
  branchId: BranchId
  pricingType: PricingType
  policyVersion: string
}

/** Fila resumida de Order History (CN-64); el detalle completo se consulta por separado. */
export interface OrderSummary {
  id: string
  orderNumber: string
  createdAt: string
  contractVersion: 1 | 2
  /** null en Orders V1, que no registraban sucursal. */
  branchId: BranchId | null
  total: number
  currency: 'CRC'
  orderStatus: OrderStatus
  paymentStatus: PaymentStatus
}

export interface OrderHistoryPage {
  orders: OrderSummary[]
  page: number
  pageSize: number
  total: number
  hasMore: boolean
}
