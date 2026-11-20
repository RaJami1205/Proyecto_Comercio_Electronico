/** Separa el subset ProductRecord consumido de Algolia de los DTO expuestos por la API. */
import type { BranchId } from './branch.js'
import type { PricingType } from './commercial.js'

export interface HighlightedValue {
  value: string
}

export interface ProductRecord {
  objectID: string
  title: string
  sku?: string
  price?: number
  image_url?: string
  categories?: string[]
  brand?: string
  description?: string
  in_stock?: boolean
  stock_quantity?: number
  /** Campos de Algolia que el dominio valida antes de exponerlos al cliente. */
  b2b?: { available?: unknown; wholesale_price?: unknown; min_order_quantity?: unknown; discount_tiers?: unknown }
  stock_by_branch?: Partial<Record<BranchId, unknown>>
  facets?: Record<string, string | number | unknown[]>
  _highlightResult?: {
    title?: HighlightedValue
  }
}

export interface ProductSpecificationDto {
  label: string
  value: string
}

export interface ProductDto {
  id: string
  name: string
  image: string
  price: number | null
  retailPrice: number | null
  pricing: {
    type: PricingType | null
    eligible: boolean
    minOrderQuantity: number | null
    message: string | null
  }
  inventory: {
    branchId: BranchId | null
    quantity: number | null
    status: 'unselected' | 'available' | 'out-of-stock' | 'invalid'
    canFulfillMinimum: boolean | null
    message: string
  }
  canAddToCart: boolean
  inStock: boolean
  category: string
  description: string
  specifications: ProductSpecificationDto[]
}

export interface ProductSearchDto extends ProductDto {
  brand?: string
  highlightedName?: string
}
