import { useEffect, useState } from 'react'

import type { Product } from '../data/products'
import { getCatalogPage, type CatalogFilters } from '../services/productApi'

// Define la estructura expuesta por el hook para el componente consumidor,
// incluyendo productos, metadatos de paginación, facetas dinámicas
// y el estado de carga o error actual
interface UseProductCatalogResult {
  products: Product[]
  totalPages: number
  nbHits: number
  facets: Record<string, Record<string, number>>
  isLoading: boolean
  error: string | null
}

// Interfaz interna que maneja el estado de la petición, guardando
// los parámetros de la última carga exitosa (página, query, filtros)
// para calcular correctamente la bandera de `isLoading`
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

// Hook principal que orquesta la búsqueda y el filtrado del catálogo
// Sincroniza la paginación, filtros y texto de búsqueda con la API,
// gestionando estados de carga y cancelando peticiones obsoletas
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

  // Serializa los filtros complejos a string para usarlos 
  // de forma segura como dependencia dentro del useEffect.
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

  // Determina si los parámetros actuales (página, query, filtros) 
  // difieren de los últimos datos cargados exitosamente para mostrar el loader
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
