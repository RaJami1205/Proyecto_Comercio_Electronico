/** Define errores de identidad con estado HTTP y código público, sin detalles internos de Algolia. */
import type { ApiErrorCode } from '../types/apiError.js'

export class UserError extends Error {
  /** Conserva estado HTTP y código recibidos para la respuesta pública de identidad. */
  constructor(
    public readonly status: number,
    public readonly code: ApiErrorCode,
    message: string,
  ) { super(message); this.name = 'UserError' }
}
