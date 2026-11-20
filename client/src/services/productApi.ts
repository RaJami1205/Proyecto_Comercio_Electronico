/** Centraliza el acceso HTTP del cliente al catálogo; Algolia y sus credentials permanecen en el server. */
import type { Product, ProductSpecification } from '../types/product'
import type { Branch, BranchId } from '../types/branch'
import { BRANCH_IDS } from '../types/branch'

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

/** Resuelve la URL y rechaza responses no exitosas; el tipo genérico no valida el JSON en runtime. */
async function request<T>(path: string, userId?: string): Promise<T> {
  const url = path.startsWith('http') ? path : `${API_BASE_URL}${path}`

  const response = await fetch(url, {
    headers: {
      Accept: 'application/json',
      ...(userId ? { 'X-CiberNova-User-Id': userId } : {}),
    },
  })

  if (!response.ok) {
    throw new Error(`La API de productos respondió con estado ${response.status}.`)
  }

  return response.json() as Promise<T>
}

/** Serializa página, query y filtros soportados para consultar el catálogo por HTTP. */
export function getCatalogPage(
  page: number,
  productsPerPage: number,
  filters?: CatalogFilters,
  query = '',
  userId?: string,
  branchId?: BranchId | null,
): Promise<CatalogPageResponse> {
  const params = new URLSearchParams({
    page: String(page),
    perPage: String(productsPerPage),
  })

  if (query.trim()) params.set('q', query.trim())
  if (branchId) params.set('branchId', branchId)

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

  return request<CatalogPageResponse>(`/api/products?${params.toString()}`, userId)
}

/** Recupera sugerencias y highlights del endpoint de Search sin consultar Algolia directamente. */
export async function searchProducts(query: string, userId?: string, branchId?: BranchId | null): Promise<ProductSearchResult[]> {
  const params = new URLSearchParams({ q: query })
  if (branchId) params.set('branchId', branchId)
  const response = await request<ProductSearchResponse>(
    `/api/products/search?${params.toString()}`,
    userId,
  )

  return response.products
}

export interface CategoryTreeNode {
  name: string
  children: CategoryTreeNode[]
}

/** Recupera la jerarquía que utiliza el selector de categorías del catálogo. */
export async function getCategoryTree(): Promise<CategoryTreeNode[]> {
  const response = await request<{ tree: CategoryTreeNode[] }>('/api/products/categories/tree')
  return response.tree
}

/** Recupera y valida las sucursales disponibles desde el contrato público del servidor. */
export async function getBranches(): Promise<Branch[]> {
  const response = await request<unknown>('/api/branches')
  if (!isRecord(response) || !Array.isArray(response.branches)) throw new Error('La API devolvió sucursales inválidas.')
  const branches = response.branches.map((value: unknown) => {
    if (!isRecord(value) || typeof value.id !== 'string' || !BRANCH_IDS.includes(value.id as BranchId)
      || typeof value.name !== 'string' || !value.name.trim() || typeof value.available !== 'boolean') {
      throw new Error('La API devolvió sucursales inválidas.')
    }
    return { id: value.id as BranchId, name: value.name, available: value.available }
  })
  if (new Set(branches.map(branch => branch.id)).size !== branches.length) throw new Error('La API devolvió sucursales duplicadas.')
  return branches
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function parseHistorySpecification(value: unknown): ProductSpecification {
  if (!isRecord(value) || typeof value.label !== 'string' || typeof value.value !== 'string') {
    throw new Error('La API devolvió especificaciones de producto inválidas.')
  }
  return { label: value.label, value: value.value }
}

/** Valida/proyecta el DTO actual sin alterar precios, categorías ni especificaciones. */
function parseHistoryProduct(value: unknown): Product {
  const pricing = isRecord(value) && isRecord(value.pricing) ? value.pricing : null
  const inventory = isRecord(value) && isRecord(value.inventory) ? value.inventory : null
  if (!isRecord(value) || typeof value.id !== 'string' || !value.id.trim()
    || typeof value.name !== 'string' || !value.name.trim() || typeof value.image !== 'string'
    || !(value.price === null || typeof value.price === 'number' && Number.isFinite(value.price) && value.price >= 0)
    || !(value.retailPrice === null || typeof value.retailPrice === 'number' && Number.isFinite(value.retailPrice) && value.retailPrice >= 0)
    || !pricing || !(pricing.type === null || pricing.type === 'RETAIL' || pricing.type === 'WHOLESALE')
    || typeof pricing.eligible !== 'boolean' || !(pricing.minOrderQuantity === null || Number.isSafeInteger(pricing.minOrderQuantity) && Number(pricing.minOrderQuantity) >= 1)
    || !(pricing.message === null || typeof pricing.message === 'string')
    || !inventory || !(inventory.branchId === null || typeof inventory.branchId === 'string' && BRANCH_IDS.includes(inventory.branchId as BranchId))
    || !(inventory.quantity === null || Number.isSafeInteger(inventory.quantity) && Number(inventory.quantity) >= 0)
    || !['unselected', 'available', 'out-of-stock', 'invalid'].includes(String(inventory.status))
    || !(inventory.canFulfillMinimum === null || typeof inventory.canFulfillMinimum === 'boolean')
    || typeof inventory.message !== 'string' || typeof value.canAddToCart !== 'boolean'
    || typeof value.inStock !== 'boolean' || typeof value.category !== 'string' || !value.category.trim()
    || typeof value.description !== 'string' || !Array.isArray(value.specifications)) {
    throw new Error('La API devolvió un producto inválido.')
  }
  return { id: value.id, name: value.name, image: value.image, price: value.price as number | null,
    retailPrice: value.retailPrice as number | null, pricing: pricing as unknown as Product['pricing'],
    inventory: inventory as unknown as Product['inventory'], canAddToCart: value.canAddToCart as boolean, inStock: value.inStock,
    category: value.category, description: value.description,
    specifications: value.specifications.map((specification: unknown) => parseHistorySpecification(specification)) }
}

/** Resuelve hasta diez IDs únicos y conserva recencia, omitiendo únicamente productos inexistentes. */
export async function getProductsByIds(productIds: string[], userId?: string, branchId?: BranchId | null): Promise<Product[]> {
  const ids = [...new Set(productIds.slice(0, 10))]
  if (ids.length === 0) return []
  if (ids.some(id => typeof id !== 'string' || !id.trim() || id.trim() !== id)) throw new Error('Los IDs de historial no son válidos.')
  const params = new URLSearchParams()
  ids.forEach(id => params.append('ids', id))
  if (branchId) params.set('branchId', branchId)
  const response = await request<unknown>(`/api/products?${params.toString()}`, userId)
  if (!isRecord(response) || !Array.isArray(response.products)) throw new Error('La API devolvió un historial de productos inválido.')
  const products = new Map<string, Product>()
  for (const value of response.products) {
    const product = parseHistoryProduct(value)
    if (!ids.includes(product.id) || products.has(product.id)) throw new Error('La API devolvió IDs de producto inesperados.')
    products.set(product.id, product)
  }
  return ids.flatMap(id => { const product = products.get(id); return product ? [product] : [] })
}
