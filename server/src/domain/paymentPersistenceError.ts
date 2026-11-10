/** Fallos de infraestructura de Payment, separados del resultado simulado PAYMENT_ERROR. */
import { OrderError } from './orderError.js'
import { DatabaseError, isDriverQueryTimeout, sqlStateOf } from '../db/databaseError.js'

export type PaymentFailure = 'storage' | 'unavailable' | 'timeout' | 'deadlock' | 'unknown'

export class PaymentPersistenceError extends OrderError {
  readonly outcome: 'not-committed' | 'unknown'
  constructor(public readonly reason: PaymentFailure = 'storage') {
    super(503, 'UNEXPECTED_ERROR', reason === 'unknown'
      ? 'No se pudo confirmar el pago. Conserva la misma clave y solicitud para recuperar su resultado.'
      : 'La persistencia de pagos no está disponible. Conserva la misma clave para reintentar.')
    this.outcome = reason === 'unknown' ? 'unknown' : 'not-committed'
  }
}

export function paymentPersistenceError(error: unknown): PaymentPersistenceError {
  if (error instanceof PaymentPersistenceError) return error
  if (error instanceof DatabaseError && error.outcome === 'unknown') return new PaymentPersistenceError('unknown')
  const code = sqlStateOf(error)
  if (code === '57014' || (error instanceof DatabaseError && error.kind === 'timeout') || isDriverQueryTimeout(error)) return new PaymentPersistenceError('timeout')
  if (code === '40P01') return new PaymentPersistenceError('deadlock')
  return new PaymentPersistenceError(error instanceof DatabaseError && error.kind === 'unavailable' ? 'unavailable' : 'storage')
}
