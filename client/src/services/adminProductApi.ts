/**
 * Consulta administrativa de productos e inventario (CN-67). El Server aplica RBAC; el Client envía la identidad activa,
 * valida cada respuesta desde unknown y nunca persiste los resultados. Solo usa GET.
 */
import type { AdminProduct, AdminProductFilters, AdminProductPage } from '../types/adminProduct'
import { BRANCH_IDS } from '../types/branch'

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL?.trim() || '').replace(/\/+$/, '')
export const ADMIN_PRODUCTS_PAGE_SIZE = 12

/** session: elegir identidad; forbidden: rol sin permiso; not-found: producto inexistente; invalid-filter; unavailable: reintentable. */
export type AdminProductErrorKind = 'session' | 'forbidden' | 'not-found' | 'invalid-filter' | 'unavailable'

export class AdminProductApiError extends Error {
  readonly kind: AdminProductErrorKind
  constructor(kind: AdminProductErrorKind) {
    super('No se pudo consultar el catálogo administrativo.')
    this.name = 'AdminProductApiError'
    this.kind = kind
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
const nullableMoney = (value: unknown) => value === null || (typeof value === 'number' && Number.isFinite(value) && value >= 0)
const nullableCount = (value: unknown) => value === null || (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0)
const nullableText = (value: unknown) => value === null || (typeof value === 'string' && value.trim().length > 0)
const count = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
const facetMap = (value: unknown) => isRecord(value) && Object.values(value).every(count)
const ISSUES = ['RETAIL_PRICE_INVALID', 'B2B_DATA_INVALID', 'BRANCH_INVENTORY_INVALID', 'STOCK_TOTAL_MISMATCH', 'IN_STOCK_FLAG_MISMATCH']

/** Exige las cuatro sucursales en orden y estados coherentes con la cantidad recibida. */
function isAdminProduct(value: unknown): value is AdminProduct {
  if (!isRecord(value) || !isRecord(value.pricing) || !isRecord(value.inventory)) return false
  const { pricing, inventory } = value
  const branches = inventory.branches
  return typeof value.id === 'string' && value.id.length > 0 && typeof value.title === 'string'
    && nullableText(value.sku) && nullableText(value.brand) && nullableText(value.image) && value.currency === 'CRC'
    && Array.isArray(value.categories) && value.categories.every(category => typeof category === 'string')
    && nullableMoney(pricing.retailPrice) && nullableMoney(pricing.wholesalePrice)
    && (pricing.b2bAvailable === null || typeof pricing.b2bAvailable === 'boolean')
    && (pricing.minOrderQuantity === null || (typeof pricing.minOrderQuantity === 'number' && Number.isSafeInteger(pricing.minOrderQuantity) && pricing.minOrderQuantity >= 1))
    && ['eligible', 'not-available', 'invalid'].includes(String(pricing.b2bStatus))
    && nullableCount(inventory.globalStock) && nullableCount(inventory.branchTotal)
    && ['available', 'limited', 'out-of-stock', 'invalid'].includes(String(inventory.availability))
    && typeof inventory.insufficientForMoq === 'boolean'
    && Array.isArray(branches) && branches.length === BRANCH_IDS.length
    && branches.every((branch, index) => isRecord(branch) && branch.branchId === BRANCH_IDS[index] && typeof branch.name === 'string'
      && nullableCount(branch.quantity) && ['available', 'below-moq', 'out-of-stock', 'invalid'].includes(String(branch.status))
      && (branch.quantity === null) === (branch.status === 'invalid')
      && (branch.quantity !== 0 || branch.status === 'out-of-stock'))
    && Array.isArray(value.issues) && value.issues.every(issue => ISSUES.includes(String(issue)))
}

function isAdminProductPage(value: unknown, page: number): value is AdminProductPage {
  return isRecord(value) && Array.isArray(value.products) && value.products.every(isAdminProduct)
    && count(value.page) && value.page >= 1 && value.page <= page && value.pageSize === ADMIN_PRODUCTS_PAGE_SIZE
    && count(value.total) && count(value.totalPages) && value.totalPages >= 1 && value.products.length <= ADMIN_PRODUCTS_PAGE_SIZE
    && new Set(value.products.map(product => (product as AdminProduct).id)).size === value.products.length
    && isRecord(value.facets) && facetMap(value.facets.categories) && facetMap(value.facets.brands)
}

/** Construye la query omitiendo filtros vacíos; el Server valida cada valor. */
export function adminProductQuery(filters: AdminProductFilters): string {
  const query = new URLSearchParams()
  if (filters.q.trim()) query.set('q', filters.q.trim())
  if (filters.category) query.set('categories', filters.category)
  if (filters.brand) query.set('brands', filters.brand)
  if (filters.branchId) query.set('branchId', filters.branchId)
  if (filters.availability) query.set('availability', filters.availability)
  if (filters.b2b) query.set('b2b', filters.b2b)
  if (filters.sort !== 'relevance') query.set('sort', filters.sort)
  query.set('page', String(filters.page))
  query.set('pageSize', String(ADMIN_PRODUCTS_PAGE_SIZE))
  return query.toString()
}

/** Traduce el contrato HTTP a categorías de interfaz sin mostrar mensajes internos del Server. */
async function request(path: string, userId: string, signal?: AbortSignal): Promise<unknown> {
  let response: Response
  try {
    response = await fetch(API_BASE_URL + path, { method: 'GET', headers: { Accept: 'application/json', 'X-CiberNova-User-Id': userId }, signal })
  } catch (error) {
    if (signal?.aborted) throw error
    throw new AdminProductApiError('unavailable')
  }
  const body: unknown = await response.json().catch(() => null)
  if (response.status === 200) return body
  const code = isRecord(body) && isRecord(body.error) ? body.error.code : undefined
  if (response.status === 401 || code === 'USER_NOT_FOUND' || code === 'INVALID_USER_ID') throw new AdminProductApiError('session')
  if (code === 'PRODUCT_NOT_FOUND') throw new AdminProductApiError('not-found')
  if (code === 'INVALID_PRODUCT_FILTER' || code === 'INVALID_BRANCH_ID') throw new AdminProductApiError('invalid-filter')
  if (response.status === 403) throw new AdminProductApiError('forbidden')
  throw new AdminProductApiError('unavailable')
}

async function list(userId: string, filters: AdminProductFilters, signal?: AbortSignal): Promise<AdminProductPage> {
  const body = await request('/api/v2/admin/products?' + adminProductQuery(filters), userId, signal)
  if (!isAdminProductPage(body, filters.page)) throw new AdminProductApiError('unavailable')
  return body
}

async function get(userId: string, productId: string, signal?: AbortSignal): Promise<AdminProduct> {
  const body = await request('/api/v2/admin/products/' + encodeURIComponent(productId), userId, signal)
  if (!isAdminProduct(body) || body.id !== productId) throw new AdminProductApiError('unavailable')
  return body
}

export const adminProductApi = { list, get }
