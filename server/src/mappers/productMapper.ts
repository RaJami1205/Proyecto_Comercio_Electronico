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

export function mapProductRecord(record: ProductRecord): ProductDto {
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

export function mapSearchProductRecord(record: ProductRecord): ProductSearchDto {
  return {
    ...mapProductRecord(record),
    brand: record.brand,
    highlightedName: record._highlightResult?.name?.value ?? record.name,
  }
}
