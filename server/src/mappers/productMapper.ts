/** Adapta ProductRecord de Algolia a los DTO públicos sin filtrar su schema interno al cliente. */
import type {
  ProductDto,
  ProductRecord,
  ProductSearchDto,
} from '../types/product.js'
import type { BranchId } from '../types/branch.js'
import type { ResolvedUser } from '../types/user.js'
import { resolvePricing } from '../domain/pricing.js'
import { getBranchInventory } from '../domain/inventory.js'

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
export function mapProductRecord(record: ProductRecord, user: ResolvedUser | null = null, branchId: BranchId | null = null): ProductDto {
  const specifications = record.facets
    ? Object.entries(record.facets).map(([label, value]) => ({
        label: humanizeKey(label),
        value: String(value),
      }))
    : []

  const pricing = resolvePricing(record, user?.role ?? null)
  const inventory = getBranchInventory(record, branchId)
  const minOrderQuantity = pricing.minOrderQuantity
  const canFulfillMinimum = inventory.status === 'unselected' || inventory.status === 'invalid'
    ? null : minOrderQuantity !== null && inventory.quantity !== null && inventory.quantity >= minOrderQuantity
  const inventoryMessage = inventory.status === 'unselected' ? 'Selecciona una sucursal para consultar existencias.'
    : inventory.status === 'invalid' ? 'No se pudo consultar el inventario de esta sucursal.'
      : inventory.status === 'out-of-stock' ? 'Agotado en esta sucursal.'
        : canFulfillMinimum === false ? `Hay ${inventory.quantity} unidades; se requieren ${minOrderQuantity} para la compra mínima.`
          : `${inventory.quantity} unidades disponibles en ${branchId}.`
  const pricingMessage = pricing.issue === 'B2B_NOT_AVAILABLE' ? 'Este producto no está disponible comercialmente para B2B.'
    : pricing.issue === 'INVALID_MOQ' ? 'El mínimo de compra B2B no es válido.'
      : pricing.issue === 'INVALID_B2B_DATA' ? 'Los datos comerciales B2B no están disponibles.'
        : pricing.issue === 'INVALID_RETAIL_PRICE' ? 'El precio público no está disponible.'
          : pricing.issue === 'ADMIN_READ_ONLY' ? 'Vista administrativa; las compras están deshabilitadas.' : null
  const inStock = inventory.status === 'unselected' ? (record.in_stock ?? (record.stock_quantity ? record.stock_quantity > 0 : false))
    : inventory.status === 'available'

  return {
    id: record.objectID,
    name: record.title,
    price: pricing.price,
    retailPrice: pricing.retailPrice,
    pricing: { type: pricing.type, eligible: pricing.eligible, minOrderQuantity, message: pricingMessage },
    inventory: { ...inventory, canFulfillMinimum, message: inventoryMessage },
    // Cart agrega unidades de una en una; B2C conserva stock total si aún no selecciona sucursal.
    canAddToCart: pricing.eligible && minOrderQuantity === 1 && (
      inventory.status === 'available' && canFulfillMinimum === true
      || inventory.status === 'unselected' && pricing.type === 'RETAIL'
        && (record.in_stock ?? (typeof record.stock_quantity === 'number' && record.stock_quantity > 0))
    ),
    image: record.image_url ?? PLACEHOLDER_IMAGE,
    category: Array.isArray(record.categories) && record.categories.length > 0
      ? record.categories[0]
      : 'Sin categoría',
    description: record.description ?? '',
    inStock,
    specifications,
  }
}

/** Extiende el DTO del catálogo con marca y highlight del título para autocomplete. */
export function mapSearchProductRecord(record: ProductRecord, user: ResolvedUser | null = null, branchId: BranchId | null = null): ProductSearchDto {
  return {
    ...mapProductRecord(record, user, branchId),
    brand: record.brand,
    highlightedName: record._highlightResult?.title?.value ?? record.title,
  }
}
