import type { BuyerInfo, DeliveryInfo } from '../types/checkout'

export type BuyerErrors = Partial<Record<keyof BuyerInfo, string>>
export type DeliveryErrors = Partial<Record<keyof DeliveryInfo, string>>

export function normalizeBuyer(value: BuyerInfo): BuyerInfo {
  return { fullName: value.fullName.trim(), email: value.email.trim(), phone: value.phone.trim() }
}

export function normalizeDelivery(value: DeliveryInfo): DeliveryInfo {
  return {
    province: value.province.trim(),
    canton: value.canton.trim(),
    address: value.address.trim(),
    additionalInfo: value.additionalInfo?.trim() ?? '',
  }
}

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

export function validateDelivery(value: DeliveryInfo): DeliveryErrors {
  const delivery = normalizeDelivery(value)
  const errors: DeliveryErrors = {}
  if (!delivery.province) errors.province = 'Ingresa la provincia.'
  if (!delivery.canton) errors.canton = 'Ingresa el cantón.'
  if (!delivery.address) errors.address = 'Ingresa la dirección de entrega.'
  return errors
}
