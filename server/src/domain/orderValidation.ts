/** Valida y normaliza el cuerpo desconocido de creación de Order antes de consultar productos. */
import type { CreateOrderRequest } from '../types/order.js'
import { OrderError } from './orderError.js'

/** Devuelve el objeto recibido o un objeto vacío cuando la entrada no tiene forma de registro. */
function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : {}
}

/** Valida en runtime y copia únicamente campos del contrato; ignora importes del navegador. */
export function validateCreateOrderRequest(value: unknown): CreateOrderRequest {
  const body = record(value)
  const buyer = record(body.buyer)
  const delivery = record(body.delivery)
  const errors: Record<string, string> = {}
  /** Lee y recorta un campo de texto; registra su error y devuelve vacío si falta o no es válido. */
  const text = (object: Record<string, unknown>, key: string, field: string): string => {
    const value = object[key]
    if (typeof value !== 'string' || !value.trim()) {
      errors[field] = 'Este campo debe ser un texto no vacío.'
      return ''
    }
    return value.trim()
  }
  const fullName = text(buyer, 'fullName', 'buyer.fullName')
  const email = text(buyer, 'email', 'buyer.email')
  const phone = text(buyer, 'phone', 'buyer.phone')
  if (email && !/^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/.test(email)) errors['buyer.email'] = 'El correo no es válido.'
  const digits = phone.replace(/\D/g, '')
  if (phone && (!/^\+?[0-9 ()-]+$/.test(phone) || digits.length < 7 || digits.length > 15)) errors['buyer.phone'] = 'El teléfono debe contener entre 7 y 15 dígitos.'
  const province = text(delivery, 'province', 'delivery.province')
  const canton = text(delivery, 'canton', 'delivery.canton')
  const address = text(delivery, 'address', 'delivery.address')
  let additionalInfo: string | undefined
  if (delivery.additionalInfo !== undefined) {
    if (typeof delivery.additionalInfo !== 'string') errors['delivery.additionalInfo'] = 'Debe ser texto.'
    else additionalInfo = delivery.additionalInfo.trim()
  }
  const idempotencyKey = text(body, 'idempotencyKey', 'idempotencyKey')
  const items: CreateOrderRequest['items'] = []
  if (!Array.isArray(body.items)) errors.items = 'Debe ser una lista de productos.'
  else {
    if (!body.items.length) errors.items = 'Incluye al menos un producto.'
    body.items.forEach((value, index) => {
      const item = record(value)
      const productId = text(item, 'productId', 'items.' + index + '.productId')
      const quantity = item.quantity
      if (typeof quantity !== 'number' || !Number.isSafeInteger(quantity) || quantity <= 0) {
        errors['items.' + index + '.quantity'] = 'La cantidad debe ser un entero positivo válido.'
      } else items.push({ productId, quantity })
    })
  }
  if (Object.keys(errors).length) {
    const empty = Array.isArray(body.items) && body.items.length === 0
    throw new OrderError(400, empty ? 'EMPTY_CART' : 'CHECKOUT_VALIDATION_ERROR', 'La información de la orden no es válida.', errors)
  }
  return { buyer: { fullName, email, phone }, delivery: { province, canton, address, ...(additionalInfo !== undefined ? { additionalInfo } : {}) }, items, idempotencyKey }
}
