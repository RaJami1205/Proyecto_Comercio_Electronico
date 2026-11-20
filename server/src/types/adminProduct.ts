/** Contratos Read-Only de la consulta administrativa de productos e inventario (CN-67). */
import type { BranchId } from './branch.js'

/**
 * available: stock positivo en las cuatro sucursales. limited: stock en algunas sucursales y agotado en al menos una
 * (definición sin umbrales numéricos nuevos). out-of-stock: ninguna sucursal tiene unidades. invalid: datos incompletos.
 */
export type AdminProductAvailability = 'available' | 'limited' | 'out-of-stock' | 'invalid'

/** below-moq: stock positivo pero menor que el MOQ B2B vigente del producto. */
export type AdminBranchStatus = 'available' | 'below-moq' | 'out-of-stock' | 'invalid'

/** eligible: B2B comprable; not-available: deshabilitado comercialmente; invalid: condiciones B2B inválidas. */
export type AdminB2BStatus = 'eligible' | 'not-available' | 'invalid'

/** Inconsistencias informadas sin corregir el dataset. */
export type AdminProductIssue =
  | 'RETAIL_PRICE_INVALID'
  | 'B2B_DATA_INVALID'
  | 'BRANCH_INVENTORY_INVALID'
  | 'STOCK_TOTAL_MISMATCH'
  | 'IN_STOCK_FLAG_MISMATCH'

export interface AdminBranchInventory {
  branchId: BranchId
  name: string
  /** Unidades de stock_by_branch para esta sucursal; null si el dato no es válido. Nunca el stock global. */
  quantity: number | null
  status: AdminBranchStatus
}

export interface AdminProductDto {
  id: string
  sku: string | null
  title: string
  brand: string | null
  categories: string[]
  image: string | null
  currency: 'CRC'
  pricing: {
    /** price del catálogo (B2C). */
    retailPrice: number | null
    /** b2b.wholesale_price tal como está en el catálogo, aunque el producto no sea elegible para B2B. */
    wholesalePrice: number | null
    b2bAvailable: boolean | null
    minOrderQuantity: number | null
    b2bStatus: AdminB2BStatus
  }
  inventory: {
    /** stock_quantity del catálogo (inventario global). */
    globalStock: number | null
    /** Suma de las cuatro sucursales; null si alguna cantidad no es válida. */
    branchTotal: number | null
    availability: AdminProductAvailability
    /** B2B elegible con stock positivo, pero ninguna sucursal alcanza el MOQ. */
    insufficientForMoq: boolean
    branches: AdminBranchInventory[]
  }
  issues: AdminProductIssue[]
}

export interface AdminProductPage {
  products: AdminProductDto[]
  page: number
  pageSize: number
  total: number
  totalPages: number
  facets: { categories: Record<string, number>; brands: Record<string, number> }
}
