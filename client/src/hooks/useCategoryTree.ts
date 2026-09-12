import { useEffect, useState } from 'react'

import { getCategoryTree, type CategoryTreeNode } from '../services/productApi'

// Define la estructura de datos devuelta por el hook,
// proporcionando el árbol jerárquico de categorías y
// un indicador booleano del estado de la petición
interface UseCategoryTreeResult {
  tree: CategoryTreeNode[]
  isLoading: boolean
}

// Hook personalizado que obtiene de forma asíncrona el árbol
// de categorías. Implementa una bandera de cancelación para prevenir
// actualizaciones de estado en componentes ya desmontados
export function useCategoryTree(): UseCategoryTreeResult {
  const [tree, setTree] = useState<CategoryTreeNode[]>([])
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    let cancelled = false

    getCategoryTree()
      .then((result) => {
        if (!cancelled) setTree(result)
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [])

  return { tree, isLoading }
}