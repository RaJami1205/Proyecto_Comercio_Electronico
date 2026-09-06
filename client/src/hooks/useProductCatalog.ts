import { useEffect, useState } from 'react'

import type { Product } from '../data/products'
import { getCatalogPage } from '../services/productApi'

interface UseProductCatalogResult {
  products: Product[]
  totalPages: number
  nbHits: number
  isLoading: boolean
  error: string | null
}

interface ProductCatalogState {
  products: Product[]
  totalPages: number
  nbHits: number
  loadedPage: number | null
  error: string | null
}

const PRODUCTS_PER_PAGE = 20

export function useProductCatalog(page: number): UseProductCatalogResult {
  const [state, setState] = useState<ProductCatalogState>({
    products: [],
    totalPages: 1,
    nbHits: 0,
    loadedPage: null,
    error: null,
  })

  useEffect(() => {
    let cancelled = false

    getCatalogPage(page, PRODUCTS_PER_PAGE)
      .then((result) => {
        if (cancelled) return
        setState({
          products: result.products,
          totalPages: Math.max(result.totalPages, 1),
          nbHits: result.totalProducts,
          loadedPage: page,
          error: null,
        })
      })
      .catch(() => {
        if (cancelled) return
        setState((currentState) => ({
          ...currentState,
          products: [],
          loadedPage: page,
          error: 'No se pudieron cargar los productos del catálogo.',
        }))
      })

    return () => {
      cancelled = true
    }
  }, [page])

  return {
    products: state.products,
    totalPages: state.totalPages,
    nbHits: state.nbHits,
    isLoading: state.loadedPage !== page,
    error: state.error,
  }
}
