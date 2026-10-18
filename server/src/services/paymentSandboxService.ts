/** Simula localmente resultados de pago sin contactar pasarelas ni manejar datos de tarjetas. */
import { setTimeout } from 'node:timers/promises'
import { isPaymentScenario } from '../domain/paymentValidation.js'
import type { SandboxPaymentRequest, SandboxPaymentResult } from '../types/payment.js'

export interface PaymentSandbox {
  process(request: SandboxPaymentRequest): Promise<SandboxPaymentResult>
}

/** Simulación local: nunca contacta pasarelas ni solicita información financiera. */
export class PaymentSandboxService implements PaymentSandbox {
  /** Valida los datos internos de Order e importe y devuelve el escenario simulado tras una espera local. */
  async process(request: SandboxPaymentRequest): Promise<SandboxPaymentResult> {
    if (!request.orderId || !Number.isFinite(request.amount) || request.amount < 0 || request.currency !== 'CRC' || !isPaymentScenario(request.scenario)) {
      throw new Error('Entrada interna inválida del Sandbox.')
    }
    // Una espera breve representa el procesamiento y permite evaluar solicitudes concurrentes.
    await setTimeout(100)
    // PAYMENT_ERROR es un resultado controlado; no lanza una excepción HTTP 500.
    return { result: request.scenario }
  }
}
