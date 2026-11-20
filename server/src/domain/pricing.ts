/** Reglas de precio y cantidad comercial reutilizables, independientes de Express y Algolia. */
import type { UserRole } from '../types/user.js'
import type { PricingType } from '../types/commercial.js'
import type { ProductRecord } from '../types/product.js'

export type PricingIssue = 'B2B_NOT_AVAILABLE' | 'INVALID_B2B_DATA' | 'INVALID_MOQ' | 'INVALID_RETAIL_PRICE' | 'ADMIN_READ_ONLY' | null

export interface ResolvedPricing {
  type: PricingType | null
  price: number | null
  retailPrice: number | null
  eligible: boolean
  minOrderQuantity: number | null
  issue: PricingIssue
}

export interface QuantityValidation {
  valid: boolean
  code: 'INVALID_QUANTITY' | 'INVALID_MOQ' | 'B2B_NOT_AVAILABLE' | null
  message: string | null
}

function validMoney(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

function validQuantity(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1
}

/** Evalúa precio público y precio B2B sin usar fallback cuando falte un dato comercial. */
export function resolvePricing(record: ProductRecord, role: UserRole | null): ResolvedPricing {
  const retailPrice = validMoney(record.price) ? record.price : null
  if (role === 'ADMIN') {
    return { type: null, price: retailPrice, retailPrice, eligible: false, minOrderQuantity: null, issue: 'ADMIN_READ_ONLY' }
  }
  if (role !== 'B2B') {
    return { type: 'RETAIL', price: retailPrice, retailPrice, eligible: retailPrice !== null,
      minOrderQuantity: 1, issue: retailPrice === null ? 'INVALID_RETAIL_PRICE' : null }
  }

  const conditions = record.b2b
  if (!conditions || typeof conditions !== 'object' || Array.isArray(conditions)) {
    return { type: 'WHOLESALE', price: null, retailPrice, eligible: false, minOrderQuantity: null, issue: 'INVALID_B2B_DATA' }
  }
  if (conditions.available !== true) {
    return { type: 'WHOLESALE', price: null, retailPrice, eligible: false, minOrderQuantity: null, issue: 'B2B_NOT_AVAILABLE' }
  }
  if (!validQuantity(conditions.min_order_quantity)) {
    return { type: 'WHOLESALE', price: null, retailPrice, eligible: false, minOrderQuantity: null, issue: 'INVALID_MOQ' }
  }
  if (!validMoney(conditions.wholesale_price)) {
    return { type: 'WHOLESALE', price: null, retailPrice, eligible: false,
      minOrderQuantity: conditions.min_order_quantity, issue: 'INVALID_B2B_DATA' }
  }
  return { type: 'WHOLESALE', price: conditions.wholesale_price, retailPrice,
    eligible: true, minOrderQuantity: conditions.min_order_quantity, issue: null }
}

/** Comprueba elegibilidad y cantidad solicitada sin rebajar un MOQ inválido a una unidad. */
export function validateCommercialQuantity(pricing: ResolvedPricing, quantity: unknown): QuantityValidation {
  if (!validQuantity(quantity)) return { valid: false, code: 'INVALID_QUANTITY', message: 'La cantidad debe ser un entero positivo.' }
  if (pricing.issue === 'INVALID_MOQ') return { valid: false, code: 'INVALID_MOQ', message: 'El mínimo comercial del producto no es válido.' }
  if (pricing.issue === 'B2B_NOT_AVAILABLE' || pricing.issue === 'INVALID_B2B_DATA' || pricing.issue === 'ADMIN_READ_ONLY') {
    return { valid: false, code: 'B2B_NOT_AVAILABLE', message: 'El producto no está habilitado para esta compra.' }
  }
  if (!pricing.eligible || pricing.minOrderQuantity === null) {
    return { valid: false, code: 'INVALID_MOQ', message: 'No se pudo validar el mínimo de compra.' }
  }
  if (quantity < pricing.minOrderQuantity) {
    return { valid: false, code: 'INVALID_MOQ', message: `La cantidad mínima para este producto es ${pricing.minOrderQuantity}.` }
  }
  return { valid: true, code: null, message: null }
}
