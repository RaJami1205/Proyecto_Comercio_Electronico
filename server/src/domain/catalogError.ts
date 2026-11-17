/** Errores públicos y tipados de pricing, MOQ, sucursales e inventario de catálogo. */
import type { ApiErrorCode } from '../types/apiError.js'

export class CatalogError extends Error {
  constructor(public readonly status: number, public readonly code: ApiErrorCode, message: string) {
    super(message)
    this.name = 'CatalogError'
  }
}
