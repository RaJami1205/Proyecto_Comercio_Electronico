import type {
  ProductDto,
  ProductRecord,
  ProductSearchDto,
} from '../types/product.js'

const PLACEHOLDER_IMAGE =
  'https://placehold.co/600x600/1f5eff/ffffff?text=CiberNova'

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

export function mapProductRecord(record: any): ProductDto {
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
    inStock: record.in_stock ?? false,
    specifications,
  }
}

export function mapSearchProductRecord(record: any): ProductSearchDto {
  return {
    ...mapProductRecord(record),
    brand: record.brand,
    highlightedName: record._highlightResult?.title?.value ?? record.title,
  }
}
