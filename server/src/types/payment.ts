import type { Order } from './order.js'

export type PaymentScenario =
  | 'PAYMENT_APPROVED'
  | 'PAYMENT_DECLINED'
  | 'PAYMENT_ERROR'

export interface ProcessPaymentRequest {
  scenario: PaymentScenario
  idempotencyKey: string
}

export interface PaymentResult {
  result: PaymentScenario
  processedAt: string
  order: Order
}

/** Entrada interna construida exclusivamente desde la Order y el scenario validado. */
export interface SandboxPaymentRequest {
  orderId: string
  amount: number
  currency: Order['currency']
  scenario: PaymentScenario
}

export interface SandboxPaymentResult {
  result: PaymentScenario
}
