import { useEffect, useState } from 'react'

import type { Product } from '../data/products'
import { getCatalogPage } from '../services/algoliaClient'
import { mapRecordToProduct } from '../services/productMapper'

interface UseProductCatalogResult {
  products: Product[]
  totalPages: number
  nbHits: number
  isLoading: boolean
  error: string | null
}

const HITS_PER_PAGE = 20

/**
 * Controlador: pide la página actual del catálogo al Modelo,
 * la traduce con el mapper, y maneja carga/error.
 * "page" que recibe es 1-indexado (como lo usa <Pagination />);
 * aquí se convierte al 0-indexado que espera Algolia.
 */
export function useProductCatalog(page: number): UseProductCatalogResult {
  const [products, setProducts] = useState<Product[]>([])
  const [totalPages, setTotalPages] = useState(1)
  const [nbHits, setNbHits] = useState(0)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setIsLoading(true)

    getCatalogPage(page - 1, HITS_PER_PAGE)
      .then((result) => {
        if (cancelled) return
        setProducts(result.hits.map(mapRecordToProduct))
        setTotalPages(Math.max(result.nbPages, 1))
        setNbHits(result.nbHits)
        setError(null)
      })
      .catch(() => {
        if (cancelled) return
        setError('No se pudieron cargar los productos del catálogo.')
        setProducts([])
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoading(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [page])

  return { products, totalPages, nbHits, isLoading, error }
}
