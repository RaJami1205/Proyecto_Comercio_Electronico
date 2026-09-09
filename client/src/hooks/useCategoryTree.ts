import { useEffect, useState } from 'react'

import { getCategoryTree, type CategoryTreeNode } from '../services/productApi'

interface UseCategoryTreeResult {
  tree: CategoryTreeNode[]
  isLoading: boolean
}

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