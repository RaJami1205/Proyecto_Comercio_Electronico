import { algoliasearch } from 'algoliasearch'


const APP_ID = import.meta.env.VITE_ALGOLIA_APP_ID
const SEARCH_API_KEY = import.meta.env.VITE_ALGOLIA_SEARCH_API_KEY
const INDEX_NAME = import.meta.env.VITE_ALGOLIA_INDEX_NAME

if (!APP_ID || !SEARCH_API_KEY || !INDEX_NAME) {
  throw new Error(
    'Faltan variables de entorno de Algolia. Revisa tu archivo .env (VITE_ALGOLIA_APP_ID, VITE_ALGOLIA_SEARCH_API_KEY, VITE_ALGOLIA_INDEX_NAME).',
  )
}

const client = algoliasearch(APP_ID, SEARCH_API_KEY)

interface HighlightedValue {
  value: string
  matchLevel: 'none' | 'partial' | 'full'
}

/**
 * Forma cruda de un registro tal como vive en el índice de Algolia.
 */
export interface ProductRecord {
  objectID: string
  name: string
  brand?: string
  category: string
  subCategory?: string
  description?: string
  tags?: string[]
  rating?: number
  sku?: string
  images?: string[]
  price_CRC?: number
  inventory?: {
    totalStock: number
    sedes?: Record<string, number>
  }
  specs?: Record<string, string | number | boolean>
  // Algolia agrega esto automáticamente a cada resultado de búsqueda,
  // con el texto que coincide envuelto en <em>...</em>.
  _highlightResult?: {
    name?: HighlightedValue
    brand?: HighlightedValue
    category?: HighlightedValue
  }
}

interface CatalogPageResult {
  hits: ProductRecord[]
  page: number
  nbPages: number
  nbHits: number
}

export async function getCatalogPage(
  page: number,
  hitsPerPage = 20,
): Promise<CatalogPageResult> {
  const response = await client.searchSingleIndex<ProductRecord>({
    indexName: INDEX_NAME,
    searchParams: { query: '', page, hitsPerPage },
  })

  return {
    hits: response.hits,
    page: response.page ?? page,
    nbPages: response.nbPages ?? 0,
    nbHits: response.nbHits ?? 0,
  }
}

export async function searchProducts(query: string): Promise<ProductRecord[]> {
  const { hits } = await client.searchSingleIndex<ProductRecord>({
    indexName: INDEX_NAME,
    searchParams: {
      query,
      hitsPerPage: 8,
      // Le pedimos explícitamente el resaltado, con las etiquetas que
      // vamos a usar en el HTML del dropdown.
      highlightPreTag: '<mark>',
      highlightPostTag: '</mark>',
    },
  })

  return hits
}
