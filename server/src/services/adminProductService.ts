/**
 * Consulta administrativa Read-Only (CN-67). Algolia resuelve query, categorías y marcas; sucursal, disponibilidad
 * y B2B se filtran en Server sobre el conjunto completo verificado, porque esos atributos no son facets del índice.
 * Nunca escribe en Algolia ni corrige el dataset.
 */
import { CatalogError } from '../domain/catalogError.js'
import { toAdminProduct } from '../mappers/adminProductMapper.js'
import type { AdminProductDto, AdminProductPage } from '../types/adminProduct.js'
import type { BranchId } from '../types/branch.js'
import type { ProductRecord } from '../types/product.js'
import { isBranchId } from './branchService.js'
import { getCompleteCatalog, getProductById } from './productService.js'

export const ADMIN_PRODUCTS_DEFAULT_PAGE_SIZE = 12
export const ADMIN_PRODUCTS_MAX_PAGE_SIZE = 48

const PRODUCT_AVAILABILITY = ['available', 'limited', 'out-of-stock', 'invalid', 'below-moq'] as const
const BRANCH_AVAILABILITY = ['available', 'below-moq', 'out-of-stock', 'invalid'] as const
const B2B_FILTERS = ['eligible', 'not-available', 'invalid'] as const
const SORTS = ['relevance', 'title', 'retail_asc', 'retail_desc', 'stock_asc', 'stock_desc'] as const

export interface AdminProductQuery {
  q: string
  categories: string[]
  brands: string[]
  branchId: BranchId | null
  availability: (typeof PRODUCT_AVAILABILITY)[number] | null
  b2b: (typeof B2B_FILTERS)[number] | null
  sort: (typeof SORTS)[number]
  page: number
  pageSize: number
}

function invalidFilter(field: string): CatalogError {
  return new CatalogError(400, 'INVALID_PRODUCT_FILTER', `El filtro ${field} no es válido.`)
}

function stringList(value: unknown, field: string): string[] {
  if (value === undefined) return []
  const values = Array.isArray(value) ? value : [value]
  if (values.length > 20 || !values.every((item): item is string => typeof item === 'string' && item.trim().length > 0 && item.length <= 120)) {
    throw invalidFilter(field)
  }
  return [...new Set(values.map(item => item.trim()))]
}

function single(value: unknown, field: string): string | null {
  if (value === undefined || value === '') return null
  if (typeof value !== 'string') throw invalidFilter(field)
  return value
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], field: string): T | null {
  const text = single(value, field)
  if (text === null) return null
  if (!(allowed as readonly string[]).includes(text)) throw invalidFilter(field)
  return text as T
}

function positiveInteger(value: unknown, field: string, fallback: number, maximum = Number.MAX_SAFE_INTEGER): number {
  const text = single(value, field)
  if (text === null) return fallback
  if (!/^[1-9][0-9]{0,8}$/.test(text) || Number(text) > maximum) throw invalidFilter(field)
  return Number(text)
}

/** Valida cada query parameter; los valores desconocidos se rechazan en lugar de ignorarse. */
export function parseAdminProductQuery(query: Record<string, unknown>): AdminProductQuery {
  const q = single(query.q, 'q')?.trim() ?? ''
  if (q.length > 120) throw invalidFilter('q')
  const branchText = single(query.branchId, 'branchId')
  if (branchText !== null && !isBranchId(branchText)) throw new CatalogError(400, 'INVALID_BRANCH_ID', 'Selecciona una sucursal válida.')
  const branchId = branchText as BranchId | null
  const availability = oneOf(query.availability, PRODUCT_AVAILABILITY, 'availability')
  if (branchId !== null && availability !== null && !(BRANCH_AVAILABILITY as readonly string[]).includes(availability)) throw invalidFilter('availability')
  return {
    q, branchId, availability,
    categories: stringList(query.categories, 'categories'),
    brands: stringList(query.brands, 'brands'),
    b2b: oneOf(query.b2b, B2B_FILTERS, 'b2b'),
    sort: oneOf(query.sort, SORTS, 'sort') ?? 'relevance',
    page: positiveInteger(query.page, 'page', 1),
    pageSize: positiveInteger(query.pageSize, 'pageSize', ADMIN_PRODUCTS_DEFAULT_PAGE_SIZE, ADMIN_PRODUCTS_MAX_PAGE_SIZE),
  }
}

/** Con sucursal se evalúa su estado; sin sucursal, la disponibilidad agregada del producto. */
function matchesAvailability(product: AdminProductDto, query: AdminProductQuery): boolean {
  if (query.availability === null) return true
  if (query.branchId !== null) {
    return product.inventory.branches.find(branch => branch.branchId === query.branchId)?.status === query.availability
  }
  if (query.availability === 'below-moq') return product.inventory.insufficientForMoq
  return product.inventory.availability === query.availability
}

/** Con sucursal, el orden por stock usa sus unidades; sin ella, la suma distribuida. Los nulos van al final. */
function stockOf(product: AdminProductDto, branchId: BranchId | null): number | null {
  if (branchId === null) return product.inventory.branchTotal
  return product.inventory.branches.find(branch => branch.branchId === branchId)?.quantity ?? null
}

function compareNullable(first: number | null, second: number | null, direction: 1 | -1): number {
  if (first === null && second === null) return 0
  if (first === null) return 1
  if (second === null) return -1
  return (first - second) * direction
}

function sortProducts(products: AdminProductDto[], query: AdminProductQuery): AdminProductDto[] {
  if (query.sort === 'relevance') return products
  const byId = (first: AdminProductDto, second: AdminProductDto) => first.id.localeCompare(second.id)
  const sorted = [...products]
  if (query.sort === 'title') sorted.sort((first, second) => first.title.localeCompare(second.title, 'es') || byId(first, second))
  else if (query.sort === 'retail_asc' || query.sort === 'retail_desc') {
    const direction = query.sort === 'retail_asc' ? 1 : -1
    sorted.sort((first, second) => compareNullable(first.pricing.retailPrice, second.pricing.retailPrice, direction) || byId(first, second))
  } else {
    const direction = query.sort === 'stock_asc' ? 1 : -1
    sorted.sort((first, second) => compareNullable(stockOf(first, query.branchId), stockOf(second, query.branchId), direction) || byId(first, second))
  }
  return sorted
}

/** Complementa cada consulta no vacía con coincidencias literales de SKU, sin alterar espacios ni puntuación. */
async function searchRecords(query: AdminProductQuery): Promise<ProductRecord[]> {
  const filters = { categories: query.categories, brands: query.brands }
  const result = await getCompleteCatalog(query.q, filters)
  if (!query.q) return result.hits
  const needle = query.q.toLowerCase()
  const bySku = (await getCompleteCatalog('', filters)).hits.filter(record =>
    typeof record.sku === 'string' && record.sku.toLowerCase().includes(needle))
  const matches = new Map<string, ProductRecord>()
  for (const record of [...bySku, ...result.hits]) {
    if (!matches.has(record.objectID)) matches.set(record.objectID, record)
  }
  return [...matches.values()]
}

/** Cuenta cada producto una sola vez por categoría/marca, después de filtrar y antes de paginar. */
function productFacets(products: AdminProductDto[]): AdminProductPage['facets'] {
  const categories = new Map<string, number>()
  const brands = new Map<string, number>()
  for (const product of products) {
    for (const category of new Set(product.categories)) {
      if (category.trim()) categories.set(category, (categories.get(category) ?? 0) + 1)
    }
    if (product.brand !== null) brands.set(product.brand, (brands.get(product.brand) ?? 0) + 1)
  }
  return { categories: Object.fromEntries(categories), brands: Object.fromEntries(brands) }
}

export async function listAdminProducts(query: AdminProductQuery): Promise<AdminProductPage> {
  const hits = await searchRecords(query)
  const products = sortProducts(hits.map(toAdminProduct).filter(product =>
    matchesAvailability(product, query) && (query.b2b === null || product.pricing.b2bStatus === query.b2b)), query)
  const total = products.length
  const totalPages = Math.max(1, Math.ceil(total / query.pageSize))
  const page = Math.min(query.page, totalPages)
  const start = (page - 1) * query.pageSize
  return {
    products: products.slice(start, start + query.pageSize), page, pageSize: query.pageSize, total, totalPages,
    facets: productFacets(products),
  }
}

export async function getAdminProduct(productId: unknown): Promise<AdminProductDto> {
  if (typeof productId !== 'string' || !productId.trim() || productId.length > 200) {
    throw new CatalogError(404, 'PRODUCT_NOT_FOUND', 'El producto solicitado no existe.')
  }
  const record = await getProductById(productId)
  if (!record || record.objectID !== productId) throw new CatalogError(404, 'PRODUCT_NOT_FOUND', 'El producto solicitado no existe.')
  return toAdminProduct(record)
}
