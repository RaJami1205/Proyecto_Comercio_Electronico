import { useState } from 'react'

// Define el límite máximo de búsquedas recientes a almacenar localmente
const MAX_SEARCHES = 5
// Llave identificadora para almacenar los datos en el localStorage
const STORAGE_KEY = 'cibernova_recent_searches'

// Hook personalizado que maneja el almacenamiento persistente 
// de las búsquedas recientes del usuario en la plataforma
export function useRecentSearches() {
  // Inicialización perezosa (lazy initialization): Lee el localStorage
  // de forma síncrona solo una vez durante el montaje inicial del componente.
  const [recentSearches, setRecentSearches] = useState<string[]>(() => {
    if (typeof window === 'undefined') return []
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored) {
      try {
        return JSON.parse(stored) as string[]
      } catch (error) {
        console.error('Error al leer búsquedas recientes', error)
        return []
      }
    }
    return []
  })

  // Agrega una nueva búsqueda al historial local de forma persistente
  // Evita entradas duplicadas y mantiene el límite máximo de elementos
  const addRecentSearch = (query: string) => {
    const trimmed = query.trim()
    if (!trimmed) return

    setRecentSearches((prev) => {
      const filtered = prev.filter((q) => q.toLowerCase() !== trimmed.toLowerCase())
      const updated = [trimmed, ...filtered].slice(0, MAX_SEARCHES)
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updated))
      return updated
    })
  }

  // Elimina una búsqueda específica del historial persistente, 
  // permitiendo al usuario gestionar sus sugerencias individuales
  const removeRecentSearch = (query: string) => {
    setRecentSearches((prev) => {
      const updated = prev.filter((q) => q !== query)
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updated))
      return updated
    })
  }

  return { recentSearches, addRecentSearch, removeRecentSearch }
}