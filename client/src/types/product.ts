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

export interface Product {
  id: string
  name: string
  image: string
  price: number
  inStock: boolean
  category: ProductCategory
  description: string
  specifications: ProductSpecification[]
}
