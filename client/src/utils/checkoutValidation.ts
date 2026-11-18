/** Normaliza y valida datos de comprador y entrega, y revisa el contexto comercial previo a crear la Order. */
import type { BuyerInfo, DeliveryInfo } from '../types/checkout'
import type { BranchId } from '../types/branch'
import type { CartItem } from '../types/cart'

export type BuyerErrors = Partial<Record<keyof BuyerInfo, string>>
export type DeliveryErrors = Partial<Record<keyof DeliveryInfo, string>>

/** Devuelve los datos del comprador sin espacios en los extremos. */
export function normalizeBuyer(value: BuyerInfo): BuyerInfo {
  return { fullName: value.fullName.trim(), email: value.email.trim(), phone: value.phone.trim() }
}

/** Devuelve la dirección sin espacios en los extremos y normaliza las notas opcionales vacías. */
export function normalizeDelivery(value: DeliveryInfo): DeliveryInfo {
  return {
    province: value.province.trim(),
    canton: value.canton.trim(),
    address: value.address.trim(),
    additionalInfo: value.additionalInfo?.trim() ?? '',
  }
}

/** Devuelve errores por campo para nombre, correo y teléfono tras normalizar los datos recibidos. */
export function validateBuyer(value: BuyerInfo): BuyerErrors {
  const buyer = normalizeBuyer(value)
  const errors: BuyerErrors = {}
  if (!buyer.fullName) errors.fullName = 'Ingresa tu nombre completo.'
  if (!buyer.email) errors.email = 'Ingresa tu correo electrónico.'
  else if (!/^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/.test(buyer.email)) {
    errors.email = 'Ingresa un correo válido, como nombre@ejemplo.com.'
  }
  const digits = buyer.phone.replace(/\D/g, '')
  if (!buyer.phone) errors.phone = 'Ingresa tu teléfono.'
  else if (!/^\+?[0-9 ()-]+$/.test(buyer.phone) || digits.length < 7 || digits.length > 15) {
    errors.phone = 'Usa entre 7 y 15 dígitos; puedes incluir espacios, guiones, paréntesis y un + inicial.'
  }
  return errors
}

/** Devuelve errores por campo cuando faltan provincia, cantón o dirección normalizados. */
export function validateDelivery(value: DeliveryInfo): DeliveryErrors {
  const delivery = normalizeDelivery(value)
  const errors: DeliveryErrors = {}
  if (!delivery.province) errors.province = 'Ingresa la provincia.'
  if (!delivery.canton) errors.canton = 'Ingresa el cantón.'
  if (!delivery.address) errors.address = 'Ingresa la dirección de entrega.'
  return errors
}

export type CommercialIssueKind = 'BRANCH_MISMATCH' | 'BELOW_MINIMUM_QUANTITY' | 'INSUFFICIENT_BRANCH_STOCK' | 'INVALID_COMMERCIAL_PRICE'

export interface CommercialIssue {
  productId: string
  kind: CommercialIssueKind
  message: string
}

/**
 * Revisa el contexto comercial conocido de cada línea antes de enviar la Order.
 * Es una verificación preventiva: el Server vuelve a validar precio, MOQ e inventario y su respuesta es la autoridad.
 * Solo bloquea cuando el contexto indica un problema; no completa datos ni elige sucursales.
 */
export function commercialIssues(items: readonly CartItem[], role: 'B2C' | 'B2B', branchId: BranchId): CommercialIssue[] {
  const expectedPricing = role === 'B2B' ? 'WHOLESALE' : 'RETAIL'
  const issues: CommercialIssue[] = []
  for (const item of items) {
    const minimum = item.minimumOrderQuantity ?? 1
    if (item.branchId !== undefined && item.branchId !== branchId) {
      issues.push({ productId: item.productId, kind: 'BRANCH_MISMATCH', message: `${item.name}: la disponibilidad se validó para otra sucursal.` })
    } else if (item.commercialEligible === false || (item.pricingType !== undefined && item.pricingType !== expectedPricing)) {
      issues.push({ productId: item.productId, kind: 'INVALID_COMMERCIAL_PRICE', message: `${item.name}: no tiene un precio comercial vigente para tu cuenta.` })
    } else if (!Number.isSafeInteger(item.quantity) || item.quantity < minimum) {
      issues.push({ productId: item.productId, kind: 'BELOW_MINIMUM_QUANTITY', message: `${item.name}: la cantidad mínima es ${minimum}.` })
    } else if ((item.inventoryStatus !== undefined && item.inventoryStatus !== 'available')
      || (typeof item.availableQuantity === 'number' && item.quantity > item.availableQuantity)) {
      issues.push({ productId: item.productId, kind: 'INSUFFICIENT_BRANCH_STOCK', message: `${item.name}: la sucursal no tiene existencias suficientes.` })
    }
  }
  return issues
}
