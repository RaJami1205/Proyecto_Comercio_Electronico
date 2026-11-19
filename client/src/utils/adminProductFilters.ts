/** Estado inicial y transición de filtros de Admin Products; el Server sigue validando cada valor. */
import type { AdminProductFilters } from '../types/adminProduct'

export const INITIAL_ADMIN_FILTERS: AdminProductFilters = {
  q: '', category: '', brand: '', branchId: '', availability: '', b2b: '', sort: 'relevance', page: 1,
}

/** Todo cambio vuelve a la página 1, salvo la paginación; "limitado" no aplica a una sola sucursal y se descarta. */
export function withFilter(current: AdminProductFilters, patch: Partial<AdminProductFilters>): AdminProductFilters {
  const next = { ...current, ...patch, page: patch.page ?? 1 }
  if (next.branchId && next.availability === 'limited') next.availability = ''
  return next
}
