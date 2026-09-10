import { getAlgoliaClient } from '../config/algolia.js'
import { getAlgoliaConfig } from '../config/env.js'
import type { ProductRecord } from '../types/product.js'

export interface CatalogFilters {
  categories?: string[]
  brands?: string[]
  minPrice?: number
  maxPrice?: number
}

export interface CatalogPageResult {
  hits: ProductRecord[]
  page: number
  totalPages: number
  totalProducts: number
  facets: Record<string, Record<string, number>>
}

export async function getCatalogPage(
  page: number,
  productsPerPage: number,
  filters: CatalogFilters = {},
): Promise<CatalogPageResult> {
  const { indexName } = getAlgoliaConfig()

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

  const response = await getAlgoliaClient().searchSingleIndex<ProductRecord>({
    indexName,
    searchParams: {
      query: '',
      page,
      hitsPerPage: productsPerPage,
      facets: ['categories', 'brand'],
      ...(facetFilters.length ? { facetFilters } : {}),
      ...(numericFilters.length ? { numericFilters } : {}),
    },
  })

  console.log('RAW HIT:', JSON.stringify(response.hits[0], null, 2))
  console.log('FACETS DISPONIBLES:', JSON.stringify(response.facets, null, 2))

  return {
    hits: response.hits,
    page: response.page ?? page,
    totalPages: response.nbPages ?? 0,
    totalProducts: response.nbHits ?? 0,
    facets: response.facets ?? {},
  }
}

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