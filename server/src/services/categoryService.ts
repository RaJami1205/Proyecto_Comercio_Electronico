import { getAlgoliaClient } from '../config/algolia.js'
import { getAlgoliaConfig } from '../config/env.js'

export interface CategoryTreeNode {
  name: string
  children: CategoryTreeNode[]
}

let cachedTree: CategoryTreeNode[] | null = null

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