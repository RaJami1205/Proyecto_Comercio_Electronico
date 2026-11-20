/** Valida inventario distribuido por sucursal y límites de cantidades sin reservar stock. */
import { CatalogError } from './catalogError.js'
import type { BranchId } from '../types/branch.js'
import type { ProductRecord } from '../types/product.js'
import { requireBranchId } from '../services/branchService.js'

export interface BranchInventory {
  branchId: BranchId | null
  quantity: number | null
  status: 'unselected' | 'available' | 'out-of-stock' | 'invalid'
}

/** Distingue sucursal no elegida, datos inválidos y stock agotado; nunca usa stock total como fallback. */
export function getBranchInventory(record: ProductRecord, branchId: BranchId | null): BranchInventory {
  if (branchId === null) return { branchId: null, quantity: null, status: 'unselected' }
  const id = requireBranchId(branchId)
  const stockByBranch: unknown = record.stock_by_branch
  if (stockByBranch === null || typeof stockByBranch !== 'object' || Array.isArray(stockByBranch)) {
    return { branchId: id, quantity: null, status: 'invalid' }
  }
  const quantity: unknown = (stockByBranch as Record<string, unknown>)[id]
  if (typeof quantity !== 'number' || !Number.isSafeInteger(quantity) || quantity < 0) {
    return { branchId: id, quantity: null, status: 'invalid' }
  }
  return { branchId: id, quantity, status: quantity > 0 ? 'available' : 'out-of-stock' }
}

/** Rechaza sucursales desconocidas, cantidades inválidas y pedidos superiores a las existencias. */
export function validateBranchQuantity(
  record: ProductRecord,
  branchId: unknown,
  quantity: unknown,
  minimumOrderQuantity = 1,
): { branchId: BranchId; availableQuantity: number } {
  const id = requireBranchId(branchId)
  if (!Number.isSafeInteger(minimumOrderQuantity) || minimumOrderQuantity < 1) {
    throw new CatalogError(422, 'INVALID_MOQ', 'El mínimo comercial del producto no es válido.')
  }
  if (!Number.isSafeInteger(quantity) || Number(quantity) < minimumOrderQuantity) {
    throw new CatalogError(422, 'INVALID_QUANTITY', `La cantidad debe ser un entero de al menos ${minimumOrderQuantity}.`)
  }
  const inventory = getBranchInventory(record, id)
  if (inventory.status === 'invalid' || inventory.quantity === null) {
    throw new CatalogError(422, 'INVENTORY_UNAVAILABLE', 'El inventario de esta sucursal no está disponible.')
  }
  if (Number(quantity) > inventory.quantity) {
    throw new CatalogError(422, 'INSUFFICIENT_INVENTORY', 'La cantidad solicitada supera las existencias de la sucursal.')
  }
  return { branchId: id, availableQuantity: inventory.quantity }
}
