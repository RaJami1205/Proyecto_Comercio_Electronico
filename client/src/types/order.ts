/** Define solicitudes de creación y snapshots de Order con productos, importes y estados transaccionales. */
import type { BuyerInfo, DeliveryInfo } from './checkout'

export interface CreateOrderItemRequest {
  productId: string
  quantity: number
}

/** Declaración capturada por Checkout; acceptedAt solo existe en el snapshot emitido por Server. */
export interface TermsAcceptanceRequest {
  readonly accepted: boolean
  readonly version: string
}

/** Solicitud del navegador con datos, referencias y consentimiento; no aporta precios ni estados confiables. */
export interface CreateOrderRequest {
  buyer: BuyerInfo
  delivery: DeliveryInfo
  items: CreateOrderItemRequest[]
  idempotencyKey: string
  termsAcceptance: TermsAcceptanceRequest
}

/** Snapshot de producto con precio y subtotal determinados por el Server. */
export interface OrderItem {
  productId: string
  name: string
  image: string
  unitPrice: number
  quantity: number
  lineSubtotal: number
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
}
