/** Traduce consultas de catálogo y Search a Algolia sin asumir el mapping de DTO públicos. */
import { getAlgoliaClient } from '../config/algolia.js'
import { getAlgoliaConfig } from '../config/env.js'
import type { ProductRecord } from '../types/product.js'
import type { UserRole } from '../types/user.js'
import { CatalogError } from '../domain/catalogError.js'
import { resolvePricing } from '../domain/pricing.js'

const B2B_HITS_PER_PAGE = 1000
const MAX_COMPLETE_SEARCH_PAGES = 100

/** Los indicadores opcionales del SDK no prueban exactitud si faltan, son inválidos o se contradicen. */
function hasExhaustiveHitCount(response: { exhaustive?: unknown; exhaustiveNbHits?: unknown }): boolean {
  const current = response.exhaustive
  let currentFlag: unknown
  if (current !== undefined) {
    if (current === null || typeof current !== 'object' || Array.isArray(current)) return false
    currentFlag = 'nbHits' in current ? current.nbHits : undefined
  }
  const flags = [currentFlag, response.exhaustiveNbHits].filter(flag => flag !== undefined)
  return flags.length > 0 && flags.every(flag => flag === true)
}

export interface CatalogFilters {
  categories?: string[]
  brands?: string[]
  minPrice?: number
  maxPrice?: number
  sort?: string
}

export interface CatalogPageResult {
  hits: ProductRecord[]
  page: number
  totalPages: number
  totalProducts: number
  facets: Record<string, Record<string, number>>
}

/** Aplica facets, precio y réplica de ordenación, convirtiendo páginas entre base uno y cero. */
export async function getCatalogPage(
  page: number,
  productsPerPage: number,
  filters: CatalogFilters = {},
  query = '',
  role: UserRole | null = null,
): Promise<CatalogPageResult> {
  if (role === 'B2B') return getWholesaleCatalogPage(page, productsPerPage, filters, query)
  const { indexName } = getAlgoliaConfig()

  // Determinar si consultamos el índice principal o la réplica
  let targetIndex = indexName
  if (filters.sort === 'price_asc') {
    targetIndex = `${indexName}_price_asc`
  } else if (filters.sort === 'price_desc') {
    targetIndex = `${indexName}_price_desc`
  }

  const facetFilters: string[][] = []
  if (filters.categories?.length) {
    for (const category of filters.categories) {
      facetFilters.push([`categories:${category}`])
    }
  }
  if (filters.brands?.length) {
    facetFilters.push(filters.brands.map((brand) => `brand:${brand}`))
  }

  const numericFilters: string[] = []
  if (typeof filters.minPrice === 'number') {
    numericFilters.push(`price>=${filters.minPrice}`)
  }
  if (typeof filters.maxPrice === 'number') {
    numericFilters.push(`price<=${filters.maxPrice}`)
  }

  // Algolia utiliza paginación basada en 0 (0 es la primera página)
  const algoliaPage = Math.max(0, page - 1)

  try {
    const response = await getAlgoliaClient().searchSingleIndex<ProductRecord>({
      indexName: targetIndex,
      searchParams: {
        query,
        page: algoliaPage,
        hitsPerPage: productsPerPage,
        facets: ['categories', 'brand'],
        ...(facetFilters.length ? { facetFilters } : {}),
        ...(numericFilters.length ? { numericFilters } : {}),
      },
    })

    return {
      hits: response.hits,
      page: (response.page ?? algoliaPage) + 1, // Convertimos de vuelta a base 1 para el cliente
      totalPages: response.nbPages ?? 0,
      totalProducts: response.nbHits ?? 0,
      facets: response.facets ?? {},
    }
  } catch (error) {
    console.error(`Error consultando el índice '${targetIndex}' en Algolia:`, error)
    throw error
  }
}

/**
 * Recupera de forma verificada todos los resultados de Algolia para query, categorías y marcas.
 * Lo reutilizan el orden B2B y la consulta administrativa (CN-67), que filtran y paginan en Server
 * atributos no indexados como facets (precio mayorista, stock_by_branch) sin modificar el índice.
 */
export async function getCompleteCatalog(query: string, filters: Pick<CatalogFilters, 'categories' | 'brands'> = {}):
  Promise<{ hits: ProductRecord[]; facets: Record<string, Record<string, number>> }> {
  const { indexName } = getAlgoliaConfig()
  const facetFilters: string[][] = []
  if (filters.categories?.length) filters.categories.forEach(category => facetFilters.push([`categories:${category}`]))
  if (filters.brands?.length) facetFilters.push(filters.brands.map(brand => `brand:${brand}`))
  const allHits: ProductRecord[] = []
  const objectIds = new Set<string>()
  let totalHits = 0
  let pageCount = 0
  let facets: Record<string, Record<string, number>> = {}

  try {
    for (let requestedPage = 0; requestedPage < Math.max(pageCount, 1); requestedPage += 1) {
      if (requestedPage >= MAX_COMPLETE_SEARCH_PAGES) {
        throw new CatalogError(503, 'CATALOG_RESULT_LIMIT', 'No se pudo ordenar con precisión el conjunto completo del catálogo B2B.')
      }
      const response = await getAlgoliaClient().searchSingleIndex<ProductRecord>({
        indexName,
        searchParams: { query, page: requestedPage, hitsPerPage: B2B_HITS_PER_PAGE, facets: ['categories', 'brand'],
          ...(facetFilters.length ? { facetFilters } : {}) },
      })
      const nbHits = response.nbHits
      const nbPages = response.nbPages
      if (!hasExhaustiveHitCount(response)) {
        throw new CatalogError(503, 'CATALOG_RESULT_LIMIT', 'No se pudo verificar un conteo exhaustivo del catálogo.')
      }
      if (typeof nbHits !== 'number' || !Number.isSafeInteger(nbHits) || nbHits < 0
        || typeof nbPages !== 'number' || !Number.isSafeInteger(nbPages) || nbPages < 0
        || response.page !== requestedPage || response.hitsPerPage !== B2B_HITS_PER_PAGE
        || !Array.isArray(response.hits)) {
        throw new CatalogError(503, 'CATALOG_RESULT_LIMIT', 'El catálogo no devolvió un conjunto completo para el orden B2B.')
      }
      if (requestedPage === 0) {
        totalHits = nbHits
        pageCount = nbPages
        facets = response.facets ?? {}
        if (pageCount !== Math.ceil(totalHits / B2B_HITS_PER_PAGE)) {
          throw new CatalogError(503, 'CATALOG_RESULT_LIMIT', 'El índice limita los resultados necesarios para ordenar el catálogo B2B.')
        }
      } else if (nbHits !== totalHits || nbPages !== pageCount) {
        throw new CatalogError(503, 'CATALOG_RESULT_LIMIT', 'El catálogo cambió durante el ordenamiento B2B; vuelve a intentarlo.')
      }
      const expectedHits = Math.min(B2B_HITS_PER_PAGE, totalHits - requestedPage * B2B_HITS_PER_PAGE)
      if (response.hits.length !== expectedHits) {
        throw new CatalogError(503, 'CATALOG_RESULT_LIMIT', 'El índice devolvió una página incompleta para el orden B2B.')
      }
      for (const hit of response.hits) {
        const id: unknown = hit?.objectID
        if (typeof id !== 'string' || !id.length || objectIds.has(id)) {
          throw new CatalogError(503, 'CATALOG_RESULT_LIMIT', 'El catálogo devolvió identificadores repetidos o inválidos.')
        }
        objectIds.add(id)
      }
      allHits.push(...response.hits)
    }
  } catch (error) {
    if (error instanceof CatalogError) throw error
    console.error('Error consultando resultados mayoristas en Algolia.')
    throw error
  }
  return { hits: allHits, facets }
}

/** Recupera todos los resultados filtrados, aplica precio mayorista y ordena antes de paginar. */
async function getWholesaleCatalogPage(page: number, productsPerPage: number, filters: CatalogFilters, query: string): Promise<CatalogPageResult> {
  const { hits: allHits, facets } = await getCompleteCatalog(query, filters)

  const filteredHits = allHits.filter(record => {
    const price = resolvePricing(record, 'B2B').price
    if (price === null) return filters.minPrice === undefined && filters.maxPrice === undefined
    return (filters.minPrice === undefined || price >= filters.minPrice)
      && (filters.maxPrice === undefined || price <= filters.maxPrice)
  })
  if (filters.sort === 'price_asc' || filters.sort === 'price_desc') {
    const direction = filters.sort === 'price_asc' ? 1 : -1
    filteredHits.sort((first, second) => {
      const firstPrice = resolvePricing(first, 'B2B').price
      const secondPrice = resolvePricing(second, 'B2B').price
      if (firstPrice === null && secondPrice === null) return first.objectID.localeCompare(second.objectID)
      if (firstPrice === null) return 1
      if (secondPrice === null) return -1
      return (firstPrice - secondPrice) * direction || first.objectID.localeCompare(second.objectID)
    })
  }
  const totalProducts = filteredHits.length
  const totalPages = Math.max(1, Math.ceil(totalProducts / productsPerPage))
  const resolvedPage = Math.max(1, Math.min(page, totalPages))
  const start = (resolvedPage - 1) * productsPerPage
  return { hits: filteredHits.slice(start, start + productsPerPage), page: resolvedPage,
    totalPages, totalProducts, facets }
}

/** Solicita hasta ocho sugerencias con marcas de highlight para el mapper. */
export async function searchProducts(query: string): Promise<ProductRecord[]> {
  const { indexName } = getAlgoliaConfig()
  const response = await getAlgoliaClient().searchSingleIndex<ProductRecord>({
    indexName,
    searchParams: {
      query,
      hitsPerPage: 8,
      highlightPreTag: '<mark>',
      highlightPostTag: '</mark>',
    },
  })

  return response.hits
}
/** Consulta por objectID exacto; un fallo del catálogo no se confunde con un producto inexistente. */
export async function getProductById(productId: string): Promise<ProductRecord | undefined> {
  const { indexName } = getAlgoliaConfig()
  try {
    return await getAlgoliaClient().getObject<ProductRecord>({ indexName, objectID: productId })
  } catch (error) {
    if (error !== null && typeof error === 'object' && 'status' in error && error.status === 404) return undefined
    throw error
  }
}
