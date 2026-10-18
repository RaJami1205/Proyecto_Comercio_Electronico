/** Define escenarios, solicitudes y resultados del Payment Sandbox, separados de los datos de tarjeta. */
import type { Order } from './order'

export type PaymentScenario =
  | 'PAYMENT_APPROVED'
  | 'PAYMENT_DECLINED'
  | 'PAYMENT_ERROR'

export interface ProcessPaymentRequest {
  scenario: PaymentScenario
  idempotencyKey: string
}

/** Resultado del intento junto con el snapshot de Order devuelto por el Server. */
export interface PaymentResult {
  result: PaymentScenario
  processedAt: string
  order: Order
}
