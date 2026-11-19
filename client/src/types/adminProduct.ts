/** Contratos de la consulta administrativa Read-Only (CN-67), sincronizados con server/src/types/adminProduct.ts. */
import type { BranchId } from './branch'

/** available: stock en las cuatro sucursales; limited: agotado en al menos una; out-of-stock: en ninguna; invalid: datos incompletos. */
export type AdminProductAvailability = 'available' | 'limited' | 'out-of-stock' | 'invalid'
export type AdminBranchStatus = 'available' | 'below-moq' | 'out-of-stock' | 'invalid'
export type AdminB2BStatus = 'eligible' | 'not-available' | 'invalid'
export type AdminProductIssue = 'RETAIL_PRICE_INVALID' | 'B2B_DATA_INVALID' | 'BRANCH_INVENTORY_INVALID' | 'STOCK_TOTAL_MISMATCH' | 'IN_STOCK_FLAG_MISMATCH'

export interface AdminBranchInventory {
  branchId: BranchId
  name: string
  quantity: number | null
  status: AdminBranchStatus
}

export interface AdminProduct {
  id: string
  sku: string | null
  title: string
  brand: string | null
  categories: string[]
  image: string | null
  currency: 'CRC'
  pricing: {
    retailPrice: number | null
    wholesalePrice: number | null
    b2bAvailable: boolean | null
    minOrderQuantity: number | null
    b2bStatus: AdminB2BStatus
  }
  inventory: {
    globalStock: number | null
    branchTotal: number | null
    availability: AdminProductAvailability
    insufficientForMoq: boolean
    branches: AdminBranchInventory[]
  }
  issues: AdminProductIssue[]
}

export interface AdminProductPage {
  products: AdminProduct[]
  page: number
  pageSize: number
  total: number
  totalPages: number
  facets: { categories: Record<string, number>; brands: Record<string, number> }
}

export type AdminAvailabilityFilter = AdminProductAvailability | 'below-moq'
export type AdminProductSort = 'relevance' | 'title' | 'retail_asc' | 'retail_desc' | 'stock_asc' | 'stock_desc'

/** Filtros enviados al Server; los vacíos no se envían. */
export interface AdminProductFilters {
  q: string
  category: string
  brand: string
  branchId: BranchId | ''
  availability: AdminAvailabilityFilter | ''
  b2b: AdminB2BStatus | ''
  sort: AdminProductSort
  page: number
}
