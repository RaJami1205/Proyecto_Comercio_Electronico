import { getAlgoliaClient } from '../config/algolia.js'
import { getAlgoliaConfig } from '../config/env.js'
import type { ProductRecord } from '../types/product.js'

export interface CatalogPageResult {
  hits: ProductRecord[]
  page: number
  totalPages: number
  totalProducts: number
}

export async function getCatalogPage(
  page: number,
  productsPerPage: number,
): Promise<CatalogPageResult> {
  const { indexName } = getAlgoliaConfig()
  const response = await getAlgoliaClient().searchSingleIndex<ProductRecord>({
    indexName,
    searchParams: {
      query: '',
      page,
      hitsPerPage: productsPerPage,
    },
  })

  return {
    hits: response.hits,
    page: response.page ?? page,
    totalPages: response.nbPages ?? 0,
    totalProducts: response.nbHits ?? 0,
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
