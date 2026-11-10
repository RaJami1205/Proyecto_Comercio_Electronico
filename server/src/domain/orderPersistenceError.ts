/** Error público compatible con el Client V1: HTTP 503 conserva la misma solicitud pendiente. */
import { OrderError } from './orderError.js'

export class OrderPersistenceError extends OrderError {
  constructor(public readonly outcome: 'not-committed' | 'unknown' = 'not-committed') {
    super(503, 'UNEXPECTED_ERROR', outcome === 'unknown'
      ? 'No se pudo confirmar la creación de la orden. Reintenta con la misma clave y solicitud.'
      : 'La persistencia de órdenes no está disponible. Conserva la misma clave para reintentar.')
  }
}
