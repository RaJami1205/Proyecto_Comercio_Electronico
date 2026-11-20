/** Comparte los códigos de identidad de las operaciones protegidas y sus mensajes públicos. */
import type { ApiErrorCode } from '../types/apiError'

export const identityErrorCodes: readonly ApiErrorCode[] = ['IDENTITY_REQUIRED', 'INVALID_USER_ID', 'USER_NOT_FOUND',
  'USER_DISABLED', 'FORBIDDEN', 'UNKNOWN_USER_ROLE', 'INVALID_USER_DATA', 'INVALID_B2B_DATA', 'USER_SERVICE_UNAVAILABLE']

/** Un rechazo de acceso no determina el resultado de un intento anterior que siga incierto. */
export function isAuthorizationRejection(code: ApiErrorCode): boolean {
  return code === 'ORDER_NOT_FOUND' || (code !== 'USER_SERVICE_UNAVAILABLE' && identityErrorCodes.includes(code))
}

/** Presenta la causa de acceso o disponibilidad sin mostrar detalles internos del Server. */
export function authorizationErrorMessage(code: ApiErrorCode): string | undefined {
  if (code === 'USER_SERVICE_UNAVAILABLE') return 'El servicio de identidades no está disponible. Reintentar conservará la misma solicitud.'
  if (code === 'USER_DISABLED') return 'Esta identidad está deshabilitada.'
  if (code === 'USER_NOT_FOUND') return 'La identidad ya no está disponible.'
  if (identityErrorCodes.includes(code)) return 'La identidad no tiene autorización para esta operación.'
  return undefined
}
