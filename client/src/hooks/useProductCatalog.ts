import { useEffect, useState } from 'react'

import type { Product } from '../data/products'
import { getCatalogPage, type CatalogFilters } from '../services/productApi'

interface UseProductCatalogResult {
  products: Product[]
  totalPages: number
  nbHits: number
  facets: Record<string, Record<string, number>>
  isLoading: boolean
  error: string | null
}

interface ProductCatalogState {
  products: Product[]
  totalPages: number
  nbHits: number
  facets: Record<string, Record<string, number>>
  loadedPage: number | null
  loadedPageSize: number | null
  loadedQuery: string | null
  loadedFilters: string | null
  error: string | null
}

export function useProductCatalog(
  page: number,
  pageSize: number,
  filters?: CatalogFilters,
  query = '',
): UseProductCatalogResult {
  const [state, setState] = useState<ProductCatalogState>({
    products: [],
    totalPages: 1,
    nbHits: 0,
    facets: {},
    loadedPage: null,
    loadedPageSize: null,
    loadedQuery: null,
    loadedFilters: null,
    error: null,
  })
  const filtersKey = JSON.stringify(filters) ?? ''

  useEffect(() => {
    let cancelled = false

    getCatalogPage(page, pageSize, filters, query)
      .then((result) => {
        if (cancelled) return
        setState({
          products: result.products,
          totalPages: Math.max(result.totalPages, 1),
          nbHits: result.totalProducts,
          facets: result.facets ?? {},
          loadedPage: page,
          loadedPageSize: pageSize,
          loadedQuery: query,
          loadedFilters: filtersKey,
          error: null,
        })
      })
      .catch(() => {
        if (cancelled) return
        setState((currentState) => ({
          ...currentState,
          products: [],
          loadedPage: page,
          loadedPageSize: pageSize,
          loadedQuery: query,
          loadedFilters: filtersKey,
          error: 'No se pudieron cargar los productos del catálogo.',
        }))
      })

    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, pageSize, filtersKey, query])

  const isLoading = state.loadedPage !== page || state.loadedPageSize !== pageSize
    || state.loadedQuery !== query || state.loadedFilters !== filtersKey

  return {
    products: state.products,
    totalPages: state.totalPages,
    nbHits: state.nbHits,
    facets: state.facets,
    isLoading,
    error: isLoading ? null : state.error,
  }
}
