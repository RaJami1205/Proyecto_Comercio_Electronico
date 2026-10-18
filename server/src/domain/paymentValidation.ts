/** Valida escenarios y claves de idempotencia recibidos para un intento de pago simulado. */
import { OrderError } from './orderError.js'
import type { PaymentScenario, ProcessPaymentRequest } from '../types/payment.js'

/** Indica si el valor pertenece a los tres escenarios permitidos del Sandbox. */
export function isPaymentScenario(value: unknown): value is PaymentScenario {
  return value === 'PAYMENT_APPROVED' || value === 'PAYMENT_DECLINED' || value === 'PAYMENT_ERROR'
}

/** Descarta campos adicionales; ningún importe ni estado proviene del navegador. */
export function validateProcessPaymentRequest(value: unknown): ProcessPaymentRequest {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new OrderError(400, 'CHECKOUT_VALIDATION_ERROR', 'La solicitud de pago no es válida.')
  }
  const body = value as Record<string, unknown>
  if (!isPaymentScenario(body.scenario)) {
    throw new OrderError(400, 'INVALID_PAYMENT_SCENARIO', 'Selecciona un escenario válido del Sandbox.')
  }
  if (typeof body.idempotencyKey !== 'string' || !body.idempotencyKey.trim()) {
    throw new OrderError(400, 'CHECKOUT_VALIDATION_ERROR', 'El intento de pago requiere una clave válida.', { idempotencyKey: 'Este campo debe ser un texto no vacío.' })
  }
  return { scenario: body.scenario, idempotencyKey: body.idempotencyKey.trim() }
}
