import type { Product } from '../data/products'

const DEFAULT_API_BASE_URL = import.meta.env.VITE_API_BASE_URL?.trim()
const configuredApiBaseUrl = import.meta.env.VITE_API_BASE_URL?.trim()
const API_BASE_URL = (configuredApiBaseUrl || DEFAULT_API_BASE_URL).replace(/\/+$/, '')

export interface ProductSearchResult extends Product {
  brand?: string
  highlightedName?: string
}

interface CatalogPageResponse {
  products: Product[]
  page: number
  totalPages: number
  totalProducts: number
}

interface ProductSearchResponse {
  products: ProductSearchResult[]
}

async function request<T>(path: string): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
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
  productsPerPage = 20,
): Promise<CatalogPageResponse> {
  const params = new URLSearchParams({
    page: String(page),
    perPage: String(productsPerPage),
  })

  return request<CatalogPageResponse>(`/api/products?${params}`)
}

export async function searchProducts(query: string): Promise<ProductSearchResult[]> {
  const params = new URLSearchParams({ q: query })
  const response = await request<ProductSearchResponse>(
    `/api/products/search?${params}`,
  )

  return response.products
}
