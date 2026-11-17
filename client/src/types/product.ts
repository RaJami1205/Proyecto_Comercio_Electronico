/** Define el contrato Product consumido por la UI; el mapping de Algolia permanece en el server. */
import type { BranchId } from './branch'
export type ProductCategory =
  | 'Laptop'
  | 'Monitor'
  | 'Mouse'
  | 'Teclado'
  | 'SSD'
  | 'GPU'
  | 'Audífonos'
  | 'Smartphone'
  | 'Memoria RAM'
  | 'Router'
  | 'Webcam'
  | 'Gabinete'

export interface ProductSpecification {
  label: string
  value: string
}

export type ProductPricingType = 'RETAIL' | 'WHOLESALE'
export type InventoryStatus = 'unselected' | 'available' | 'out-of-stock' | 'invalid'

export interface BranchInventoryView {
  branchId: BranchId | null
  quantity: number | null
  status: InventoryStatus
  canFulfillMinimum: boolean | null
  message: string
}

export interface ProductPricingView {
  type: ProductPricingType | null
  eligible: boolean
  minOrderQuantity: number | null
  message: string | null
}

export interface Product {
  id: string
  name: string
  image: string
  price: number | null
  retailPrice: number | null
  pricing: ProductPricingView
  inventory: BranchInventoryView
  canAddToCart: boolean
  inStock: boolean
  category: string
  description: string
  specifications: ProductSpecification[]
}
