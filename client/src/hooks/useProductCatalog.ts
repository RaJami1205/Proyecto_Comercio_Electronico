/** Coordina datos, facets y estado de carga del catálogo a través de productApi. */
import { useEffect, useRef, useState } from 'react'

import type { Product } from '../types/product'
import { getCatalogPage, type CatalogFilters } from '../services/productApi'
import { trackEvent } from '../services/analytics'
import type { BranchId } from '../types/branch'

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
  loadedUserId: string | null
  loadedBranchId: BranchId | null
  error: string | null
}

/** Consulta por página, filtros y query e ignora respuestas de efectos cancelados. */
export function useProductCatalog(
  page: number,
  pageSize: number,
  filters?: CatalogFilters,
  query = '',
  userId?: string | null,
  searchSource: 'catalog' | 'recent' = 'catalog',
  branchId: BranchId | null = null,
): UseProductCatalogResult {
  const executedQuery = useRef(query)
  const [state, setState] = useState<ProductCatalogState>({
    products: [],
    totalPages: 1,
    nbHits: 0,
    facets: {},
    loadedPage: null,
    loadedPageSize: null,
    loadedQuery: null,
    loadedFilters: null,
    loadedUserId: null,
    loadedBranchId: null,
    error: null,
  })
  const filtersKey = JSON.stringify(filters) ?? ''

  useEffect(() => {
    let cancelled = false

    const request = getCatalogPage(page, pageSize, filters, query, userId ?? undefined, branchId)
    // La consulta ya se ejecutó. El ref separa cambios de query de filtros, páginas y replay de Effects.
    if (query.trim() && executedQuery.current !== query) {
      trackEvent({ type: 'SEARCH_PERFORMED', occurredAt: new Date().toISOString(), metadata: { source: searchSource } }, userId)
    }
    executedQuery.current = query
    request
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
          loadedUserId: userId ?? null,
          loadedBranchId: branchId,
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
          loadedUserId: userId ?? null,
          loadedBranchId: branchId,
          error: 'No se pudieron cargar los productos del catálogo.',
        }))
      })

    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, pageSize, filtersKey, query, userId, branchId])

  const isLoading = state.loadedPage !== page || state.loadedPageSize !== pageSize
    || state.loadedQuery !== query || state.loadedFilters !== filtersKey
    || state.loadedUserId !== (userId ?? null) || state.loadedBranchId !== branchId

  return {
    products: state.products,
    totalPages: state.totalPages,
    nbHits: state.nbHits,
    facets: state.facets,
    isLoading,
    error: isLoading ? null : state.error,
  }
}
