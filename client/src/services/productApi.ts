import type { Product } from '../types/product'

const configuredApiBaseUrl = import.meta.env.VITE_API_BASE_URL?.trim() || ''
const API_BASE_URL = configuredApiBaseUrl.replace(/\/+$/, '')

export type SortOption = 'relevance' | 'price_asc' | 'price_desc'

export interface ProductSearchResult extends Product {
  brand?: string
  highlightedName?: string
}

export interface CatalogFilters {
  categories: string[]
  brands: string[]
  specifications: Record<string, string[]>
  minPrice: string
  maxPrice: string
  sort?: SortOption
}

interface CatalogPageResponse {
  products: Product[]
  page: number
  totalPages: number
  totalProducts: number
  facets: Record<string, Record<string, number>>
}

interface ProductSearchResponse {
  products: ProductSearchResult[]
}

async function request<T>(path: string): Promise<T> {
  const url = path.startsWith('http') ? path : `${API_BASE_URL}${path}`

  const response = await fetch(url, {
    headers: {
      Accept: 'application/json',
    },
  })

  if (!response.ok) {
    throw new Error(`La API de productos respondió con estado ${response.status}.`)
  }

  return response.json() as Promise<T>
}

export function getCatalogPage(
  page: number,
  productsPerPage: number,
  filters?: CatalogFilters,
  query = '',
): Promise<CatalogPageResponse> {
  const params = new URLSearchParams({
    page: String(page),
    perPage: String(productsPerPage),
  })

  if (query.trim()) params.set('q', query.trim())

  filters?.categories?.forEach((category) => params.append('categories', category))
  filters?.brands?.forEach((brand) => params.append('brands', brand))

  const minPrice = filters?.minPrice?.trim()
  const maxPrice = filters?.maxPrice?.trim()

  if (minPrice && !isNaN(Number(minPrice))) {
    params.set('minPrice', minPrice)
  }

  if (maxPrice && !isNaN(Number(maxPrice))) {
    params.set('maxPrice', maxPrice)
  }

  if (filters?.sort) {
    params.set('sort', filters.sort)
  }

  return request<CatalogPageResponse>(`/api/products?${params.toString()}`)
}

export async function searchProducts(query: string): Promise<ProductSearchResult[]> {
  const params = new URLSearchParams({ q: query })
  const response = await request<ProductSearchResponse>(
    `/api/products/search?${params.toString()}`,
  )

  return response.products
}

export interface CategoryTreeNode {
  name: string
  children: CategoryTreeNode[]
}

export async function getCategoryTree(): Promise<CategoryTreeNode[]> {
  const response = await request<{ tree: CategoryTreeNode[] }>('/api/products/categories/tree')
  return response.tree
}