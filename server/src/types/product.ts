export interface HighlightedValue {
  value: string
}

export interface ProductRecord {
  objectID: string
  title: string
  price?: number
  image_url?: string
  categories?: string[]
  brand?: string
  description?: string
  in_stock?: boolean
  stock_quantity?: number
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
