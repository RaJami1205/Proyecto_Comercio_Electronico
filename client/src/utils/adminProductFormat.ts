/** Etiquetas y tonos de la consulta administrativa; solo presentan los valores recibidos del Server. */
import type { AdminB2BStatus, AdminBranchStatus, AdminProductAvailability, AdminProductIssue } from '../types/adminProduct'
import { formatOrderMoney } from './orderHistoryFormat'

export type AdminTone = 'neutral' | 'success' | 'danger' | 'warning'

export const AVAILABILITY_LABELS: Readonly<Record<AdminProductAvailability, string>> = {
  available: 'Disponible en todas las sucursales', limited: 'Stock limitado', 'out-of-stock': 'Agotado', invalid: 'Inventario no disponible',
}
export const AVAILABILITY_TONES: Readonly<Record<AdminProductAvailability, AdminTone>> = {
  available: 'success', limited: 'warning', 'out-of-stock': 'danger', invalid: 'danger',
}
export const BRANCH_STATUS_LABELS: Readonly<Record<AdminBranchStatus, string>> = {
  available: 'Disponible', 'below-moq': 'Menor al MOQ B2B', 'out-of-stock': 'Agotado', invalid: 'Dato inválido',
}
export const BRANCH_STATUS_TONES: Readonly<Record<AdminBranchStatus, AdminTone>> = {
  available: 'success', 'below-moq': 'warning', 'out-of-stock': 'danger', invalid: 'danger',
}
export const B2B_STATUS_LABELS: Readonly<Record<AdminB2BStatus, string>> = {
  eligible: 'B2B habilitado', 'not-available': 'B2B no disponible', invalid: 'Condiciones B2B inválidas',
}
export const B2B_STATUS_TONES: Readonly<Record<AdminB2BStatus, AdminTone>> = {
  eligible: 'success', 'not-available': 'neutral', invalid: 'danger',
}
export const ISSUE_LABELS: Readonly<Record<AdminProductIssue, string>> = {
  RETAIL_PRICE_INVALID: 'El precio Retail del catálogo no es válido.',
  B2B_DATA_INVALID: 'Las condiciones B2B (precio mayorista o MOQ) no son válidas.',
  BRANCH_INVENTORY_INVALID: 'Falta o es inválida la cantidad de al menos una sucursal.',
  STOCK_TOTAL_MISMATCH: 'El stock global no coincide con la suma de las sucursales.',
  IN_STOCK_FLAG_MISMATCH: 'El indicador "en stock" no coincide con las existencias por sucursal.',
}

export const formatAdminMoney = (value: number | null) => value === null ? 'No disponible' : formatOrderMoney(value)
export const formatUnits = (value: number | null) => value === null ? 'No disponible' : `${value} ${value === 1 ? 'unidad' : 'unidades'}`
