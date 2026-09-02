import type { Product } from '../data/products'
import type { ProductRecord } from './algoliaClient'

// Imagen que se muestra mientras no subas imágenes reales al índice
// (viste que "images" llegaba vacío: []).
const PLACEHOLDER_IMAGE =
  'https://placehold.co/600x600/1f5eff/ffffff?text=CiberNova'

/**
 * Convierte "camelCase" o "snake_case" a un texto legible:
 * "coolingSupport" -> "Cooling Support"
 */
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

/**
 * Único lugar del proyecto que sabe cómo pasar de "como Algolia guarda
 * los datos" a "como el resto de la app espera los datos" (el tipo
 * Product que ya usan ProductCard, ProductGrid y ProductQuickView).
 */
export function mapRecordToProduct(record: ProductRecord): Product {
  const specifications = record.specs
    ? Object.entries(record.specs).map(([label, value]) => ({
        label: humanizeKey(label),
        value: String(value),
      }))
    : []

  return {
    id: record.objectID,
    name: record.name,
    price: record.price_CRC ?? 0,
    image: record.images?.[0] ?? PLACEHOLDER_IMAGE,
    category: record.category,
    description: record.description ?? '',
    inStock: (record.inventory?.totalStock ?? 0) > 0,
    specifications,
  }
}
