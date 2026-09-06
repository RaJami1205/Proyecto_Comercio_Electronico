import { useEffect, useRef, useState } from 'react'

import { searchProducts, type ProductRecord } from '../services/algoliaClient'

const DEBOUNCE_MS = 200

interface UseProductSearchResult {
  query: string
  setQuery: (value: string) => void
  results: ProductRecord[]
  isLoading: boolean
  error: string | null
}

/**
 * Controlador: conecta la Vista (lo que el usuario escribe) con el
 * Modelo (searchProducts). Decide CUÁNDO buscar (debounce), maneja
 * el estado de carga/error, y no sabe nada de cómo se ve la UI.
 */
export function useProductSearch(): UseProductSearchResult {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<ProductRecord[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const requestIdRef = useRef(0)

  useEffect(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current)
    }

    if (!query.trim()) {
      setResults([])
      setError(null)
      setIsLoading(false)
      return
    }

    setIsLoading(true)

    debounceRef.current = setTimeout(() => {
      const currentRequestId = ++requestIdRef.current

      searchProducts(query)
        .then((hits) => {
          if (currentRequestId === requestIdRef.current) {
            setResults(hits)
            setError(null)
          }
        })
        .catch(() => {
          if (currentRequestId === requestIdRef.current) {
            setError('No se pudo completar la búsqueda. Intenta de nuevo.')
            setResults([])
          }
        })
        .finally(() => {
          if (currentRequestId === requestIdRef.current) {
            setIsLoading(false)
          }
        })
    }, DEBOUNCE_MS)

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current)
      }
    }
  }, [query])

  return { query, setQuery, results, isLoading, error }
}
