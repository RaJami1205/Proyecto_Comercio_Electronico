import { algoliasearch } from 'algoliasearch'

// Estas variables se leen del archivo .env (ver .env.example).
const APP_ID = import.meta.env.VITE_ALGOLIA_APP_ID
const SEARCH_API_KEY = import.meta.env.VITE_ALGOLIA_SEARCH_API_KEY
const INDEX_NAME = import.meta.env.VITE_ALGOLIA_INDEX_NAME

if (!APP_ID || !SEARCH_API_KEY || !INDEX_NAME) {
  throw new Error(
    'Faltan variables de entorno de Algolia. Revisa tu archivo .env (VITE_ALGOLIA_APP_ID, VITE_ALGOLIA_SEARCH_API_KEY, VITE_ALGOLIA_INDEX_NAME).',
  )
}

const client = algoliasearch(APP_ID, SEARCH_API_KEY)

/**
 * Forma cruda de un registro tal como vive en el índice de Algolia.
 * Si agregas o renombras atributos en el índice, actualiza esta interfaz.
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
}

interface CatalogPageResult {
  hits: ProductRecord[]
  page: number
  nbPages: number
  nbHits: number
}

/**
 * Trae una página del catálogo completo (sin filtro de búsqueda).
 * "page" es 0-indexado, como lo espera Algolia.
 * hitsPerPage usa el valor ya configurado en el dashboard (Pagination)
 * si no se pasa uno explícito.
 */
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
    page: response.page,
    nbPages: response.nbPages,
    nbHits: response.nbHits,
  }
}

/**
 * Búsqueda por texto libre, usada por el buscador del toolbar.
 */
export async function searchProducts(query: string): Promise<ProductRecord[]> {
  const { hits } = await client.searchSingleIndex<ProductRecord>({
    indexName: INDEX_NAME,
    searchParams: { query },
  })

  return hits
}
