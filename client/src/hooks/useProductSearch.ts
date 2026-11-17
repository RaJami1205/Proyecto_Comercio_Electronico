/** Encapsula las requests de autocomplete a productApi y su estado de carga. */
import { useEffect, useRef, useState } from 'react'

import {
  searchProducts,
  type ProductSearchResult,
} from '../services/productApi'
import type { BranchId } from '../types/branch'

const DEBOUNCE_MS = 200

interface UseProductSearchResult {
  query: string
  setQuery: (value: string) => void
  results: ProductSearchResult[]
  isLoading: boolean
  error: string | null
}

/** Aplica debounce y descarta respuestas de queries reemplazados mediante un identificador. */
export function useProductSearch(userId?: string, branchId?: BranchId | null): UseProductSearchResult {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<ProductSearchResult[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loadedKey, setLoadedKey] = useState('')
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const requestIdRef = useRef(0)
  const contextKey = `${query}\u0000${userId ?? ''}\u0000${branchId ?? ''}`

  useEffect(() => {
    const currentRequestId = ++requestIdRef.current
    if (debounceRef.current) {
      clearTimeout(debounceRef.current)
    }

    if (!query.trim()) {
      return
    }

    debounceRef.current = setTimeout(() => {
      setResults([])
      setError(null)
      setIsLoading(true)
      searchProducts(query, userId, branchId)
        .then((products) => {
          if (currentRequestId === requestIdRef.current) {
            setResults(products)
            setError(null)
            setLoadedKey(contextKey)
          }
        })
        .catch(() => {
          if (currentRequestId === requestIdRef.current) {
            setError('No se pudo completar la búsqueda. Intenta de nuevo.')
            setResults([])
            setLoadedKey(contextKey)
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
  }, [query, userId, branchId, contextKey])

  /** Invalida respuestas anteriores y limpia resultados cuando el query queda vacío. */
  function updateQuery(value: string) {
    requestIdRef.current += 1
    setQuery(value)
    setError(null)
    setResults([])

    if (value.trim()) {
      setIsLoading(true)
      return
    }

    setIsLoading(false)
    setLoadedKey(`${value}\u0000${userId ?? ''}\u0000${branchId ?? ''}`)
  }

  return { query, setQuery: updateQuery, results: loadedKey === contextKey ? results : [], isLoading: Boolean(query.trim()) && loadedKey !== contextKey || isLoading, error: loadedKey === contextKey ? error : null }
}
