import { useEffect, useRef, useState } from 'react'

import {
  searchProducts,
  type ProductSearchResult,
} from '../services/productApi'

// Define el tiempo de espera en milisegundos para retrasar la búsqueda
// a la API, optimizando el rendimiento mientras el usuario teclea
const DEBOUNCE_MS = 200

// Define la interfaz del resultado del hook, exponiendo el estado
// de la consulta, los resultados autocompletados, indicadores
// de carga y la función para actualizar la consulta de forma segura
interface UseProductSearchResult {
  query: string
  setQuery: (value: string) => void
  results: ProductSearchResult[]
  isLoading: boolean
  error: string | null
}

// Hook que maneja el autocompletado en tiempo real en la barra de búsqueda
// Implementa "debouncing" para reducir llamadas al servidor y rastrea el ID
// de cada petición (requestIdRef) para ignorar respuestas de solicitudes antiguas
export function useProductSearch(): UseProductSearchResult {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<ProductSearchResult[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const requestIdRef = useRef(0)

  // Dispara de forma asíncrona y retrasada la petición al catálogo
  // cada vez que el valor del query cambia
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

  // Actualiza el estado local de la consulta de forma segura,
  // incrementando el ID de petición y limpiando errores previos
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
