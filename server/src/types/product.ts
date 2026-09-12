export interface HighlightedValue {
  value: string
}

export interface ProductRecord {
  objectID: string
  name: string
  brand?: string
  category: string
  subCategory?: string
  description?: string
  tags?: string[]
  rating?: number
  sku?: string
  images?: string[]
  price_CRC?: number
  inventory?: {
    totalStock: number
    sedes?: Record<string, number>
  }
  specs?: Record<string, string | number | boolean>
  _highlightResult?: {
    name?: HighlightedValue
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
  price: number
  inStock: boolean
  category: string
  description: string
  specifications: ProductSpecificationDto[]
}

export interface ProductSearchDto extends ProductDto {
  brand?: string
  highlightedName?: string
}
