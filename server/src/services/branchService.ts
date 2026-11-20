/** Catálogo estable de sucursales; no requiere database ni modifica inventario. */
import { CatalogError } from '../domain/catalogError.js'
import type { Branch, BranchId } from '../types/branch.js'

const branches: readonly Branch[] = Object.freeze([
  { id: 'san_jose', name: 'San José', available: true },
  { id: 'alajuela', name: 'Alajuela', available: true },
  { id: 'cartago', name: 'Cartago', available: true },
  { id: 'heredia', name: 'Heredia', available: true },
])

export function getBranches(): Branch[] { return branches.map(branch => ({ ...branch })) }

export function isBranchId(value: unknown): value is BranchId {
  return typeof value === 'string' && branches.some(branch => branch.id === value)
}

export function requireBranchId(value: unknown): BranchId {
  if (!isBranchId(value)) throw new CatalogError(400, 'INVALID_BRANCH_ID', 'Selecciona una sucursal válida.')
  return value
}
