/** Adapta ProductRecord de Algolia a los DTO públicos sin filtrar su schema interno al cliente. */
import type {
  ProductDto,
  ProductRecord,
  ProductSearchDto,
} from '../types/product.js'

const PLACEHOLDER_IMAGE =
  'https://placehold.co/600x600/1f5eff/ffffff?text=CiberNova'

/** Convierte claves de facets en etiquetas legibles para las especificaciones. */
function humanizeKey(key: string): string {
  const withSpaces = key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/_/g, ' ')

  return withSpaces
    .split(' ')
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

/** Construye el DTO con fallbacks de imagen, categoría y stock. */
export function mapProductRecord(record: ProductRecord): ProductDto {
  const specifications = record.facets
    ? Object.entries(record.facets).map(([label, value]) => ({
        label: humanizeKey(label),
        value: String(value),
      }))
    : []

  return {
    id: record.objectID,
    name: record.title,
    price: record.price ?? 0,
    image: record.image_url ?? PLACEHOLDER_IMAGE,
    category: Array.isArray(record.categories) && record.categories.length > 0
      ? record.categories[0]
      : 'Sin categoría',
    description: record.description ?? '',
    inStock: record.in_stock ?? (record.stock_quantity ? record.stock_quantity > 0 : false),
    specifications,
  }
}

/** Extiende el DTO del catálogo con marca y highlight del título para autocomplete. */
export function mapSearchProductRecord(record: ProductRecord): ProductSearchDto {
  return {
    ...mapProductRecord(record),
    brand: record.brand,
    highlightedName: record._highlightResult?.title?.value ?? record.title,
  }
}
