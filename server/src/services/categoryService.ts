/** Construye el árbol de categorías desde Algolia y conserva una caché en memoria del proceso. */
import { getAlgoliaClient } from '../config/algolia.js'
import { getAlgoliaConfig } from '../config/env.js'

export interface CategoryTreeNode {
  name: string
  children: CategoryTreeNode[]
}

let cachedTree: CategoryTreeNode[] | null = null

/** Integra una ruta de categorías reutilizando nodos existentes en cada nivel. */
function insertPath(roots: CategoryTreeNode[], path: string[]): void {
  let level = roots
  for (const segment of path) {
    let node = level.find((candidate) => candidate.name === segment)
    if (!node) {
      node = { name: segment, children: [] }
      level.push(node)
    }
    level = node.children
  }
}

/** Devuelve la caché o la construye con hasta mil hits que contienen categorías. */
export async function getCategoryTree(): Promise<CategoryTreeNode[]> {
  if (cachedTree) {
    return cachedTree
  }

  const { indexName } = getAlgoliaConfig()
  const response = await getAlgoliaClient().searchSingleIndex<{ categories?: string[] }>({
    indexName,
    searchParams: {
      query: '',
      hitsPerPage: 1000,
      attributesToRetrieve: ['categories'],
    },
  })

  const roots: CategoryTreeNode[] = []
  for (const hit of response.hits) {
    if (Array.isArray(hit.categories) && hit.categories.length > 0) {
      insertPath(roots, hit.categories)
    }
  }

  cachedTree = roots
  return roots
}