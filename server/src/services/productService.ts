/** Traduce consultas de catálogo y Search a Algolia sin asumir el mapping de DTO públicos. */
import { getAlgoliaClient } from '../config/algolia.js'
import { getAlgoliaConfig } from '../config/env.js'
import type { ProductRecord } from '../types/product.js'

type ProductRecordWithPrice = ProductRecord & { price?: number }

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
): Promise<CatalogPageResult> {
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
    const response = await getAlgoliaClient().searchSingleIndex<ProductRecordWithPrice>({
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