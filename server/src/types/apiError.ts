/** Define los códigos y la estructura pública de errores de la API. */
export type ApiErrorCode =
  | 'CHECKOUT_VALIDATION_ERROR'
  | 'EMPTY_CART'
  | 'PRODUCT_NOT_FOUND'
  | 'ORDER_NOT_FOUND'
  | 'ORDER_ALREADY_CONFIRMED'
  | 'PAYMENT_IN_PROGRESS'
  | 'INVALID_PAYMENT_SCENARIO'
  | 'INVALID_USER_ID'
  | 'USER_NOT_FOUND'
  | 'USER_DISABLED'
  | 'UNKNOWN_USER_ROLE'
  | 'INVALID_USER_DATA'
  | 'INVALID_B2B_DATA'
  | 'USER_SERVICE_UNAVAILABLE'
  | 'UNEXPECTED_ERROR'

export interface ApiErrorResponse {
  error: {
    code: ApiErrorCode
    message: string
    fieldErrors?: Record<string, string>
  }
}
