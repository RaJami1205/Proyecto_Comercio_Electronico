/** Encapsula las requests de autocomplete a productApi y su estado de carga. */
import { useEffect, useRef, useState } from 'react'

import {
  searchProducts,
  type ProductSearchResult,
} from '../services/productApi'

const DEBOUNCE_MS = 200

interface UseProductSearchResult {
  query: string
  setQuery: (value: string) => void
  results: ProductSearchResult[]
  isLoading: boolean
  error: string | null
}

/** Aplica debounce y descarta respuestas de queries reemplazados mediante un identificador. */
export function useProductSearch(): UseProductSearchResult {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<ProductSearchResult[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const requestIdRef = useRef(0)

  useEffect(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current)
    }

    if (!query.trim()) {
      return
    }

    debounceRef.current = setTimeout(() => {
      const currentRequestId = requestIdRef.current

      searchProducts(query)
        .then((products) => {
          if (currentRequestId === requestIdRef.current) {
            setResults(products)
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

  /** Invalida respuestas anteriores y limpia resultados cuando el query queda vacío. */
  function updateQuery(value: string) {
    requestIdRef.current += 1
    setQuery(value)
    setError(null)

    if (value.trim()) {
      setIsLoading(true)
      return
    }

    setResults([])
    setIsLoading(false)
  }

  return { query, setQuery: updateQuery, results, isLoading, error }
}
