/** Define errores de dominio con estado HTTP, código público y errores opcionales por campo. */
import type { ApiErrorCode } from '../types/apiError.js'

export class OrderError extends Error {
  /** Conserva estado HTTP, código y errores de campo recibidos para la respuesta pública del dominio. */
  constructor(
    public readonly status: number,
    public readonly code: ApiErrorCode,
    message: string,
    public readonly fieldErrors?: Record<string, string>,
  ) { super(message); this.name = 'OrderError' }
}
