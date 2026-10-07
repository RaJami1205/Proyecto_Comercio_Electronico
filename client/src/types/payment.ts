import type { Order } from './order'

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
