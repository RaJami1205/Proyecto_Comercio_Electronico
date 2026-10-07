export type ApiErrorCode =
  | 'CHECKOUT_VALIDATION_ERROR'
  | 'EMPTY_CART'
  | 'PRODUCT_NOT_FOUND'
  | 'ORDER_NOT_FOUND'
  | 'ORDER_ALREADY_CONFIRMED'
  | 'PAYMENT_IN_PROGRESS'
  | 'INVALID_PAYMENT_SCENARIO'
  | 'UNEXPECTED_ERROR'

export interface ApiErrorResponse {
  error: {
    code: ApiErrorCode
    message: string
    fieldErrors?: Record<string, string>
  }
}
