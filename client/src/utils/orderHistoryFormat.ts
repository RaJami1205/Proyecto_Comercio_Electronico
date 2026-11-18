/** Etiquetas y formatos de Order History; solo presentan el snapshot recibido, nunca recalculan importes. */
import type { BranchId } from '../types/branch'
import type { OrderStatus, PaymentStatus } from '../types/order'

export const BRANCH_LABELS: Readonly<Record<BranchId, string>> = {
  san_jose: 'San José', alajuela: 'Alajuela', cartago: 'Cartago', heredia: 'Heredia',
}

export const ORDER_STATUS_LABELS: Readonly<Record<OrderStatus, string>> = { PENDING: 'Pendiente', CONFIRMED: 'Confirmada' }

export const PAYMENT_STATUS_LABELS: Readonly<Record<PaymentStatus, string>> = {
  PENDING: 'Pago pendiente', APPROVED: 'Pago aprobado', DECLINED: 'Pago rechazado', ERROR: 'Error en el pago',
}

/** Tono visual por estado de Payment, compartido por listado y detalle. */
export const PAYMENT_STATUS_TONES: Readonly<Record<PaymentStatus, 'neutral' | 'success' | 'danger' | 'warning'>> = {
  PENDING: 'neutral', APPROVED: 'success', DECLINED: 'danger', ERROR: 'warning',
}

const moneyFormatter = new Intl.NumberFormat('es-CR', { style: 'currency', currency: 'CRC' })
const dateFormatter = new Intl.DateTimeFormat('es-CR', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Costa_Rica' })

export const formatOrderMoney = (value: number) => moneyFormatter.format(value)
export const formatOrderDate = (value: string) => dateFormatter.format(new Date(value))
export const branchLabel = (branchId: BranchId | null | undefined) => branchId ? BRANCH_LABELS[branchId] : 'No registrada'
