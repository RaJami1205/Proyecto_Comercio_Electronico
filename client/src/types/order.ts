/** Define solicitudes de creación y snapshots de Order con productos, importes y estados transaccionales. */
import type { BuyerInfo, DeliveryInfo } from './checkout'

export interface CreateOrderItemRequest {
  productId: string
  quantity: number
}

/** Solicitud del navegador con datos y referencias; no contiene precios ni estados confiables. */
export interface CreateOrderRequest {
  buyer: BuyerInfo
  delivery: DeliveryInfo
  items: CreateOrderItemRequest[]
  idempotencyKey: string
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
}
