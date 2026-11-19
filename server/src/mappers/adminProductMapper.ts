/** Proyecta ProductRecord de Algolia al DTO administrativo reutilizando las reglas de Pricing e Inventory. */
import { getBranchInventory } from '../domain/inventory.js'
import { resolvePricing } from '../domain/pricing.js'
import { getBranches } from '../services/branchService.js'
import type { AdminB2BStatus, AdminBranchInventory, AdminProductDto, AdminProductIssue } from '../types/adminProduct.js'
import type { ProductRecord } from '../types/product.js'

const validMoney = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0
const validCount = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
const validMoq = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 1
const text = (value: unknown): string | null => typeof value === 'string' && value.trim() ? value : null

/** Copia valores sin redondeos ni correcciones; cada inconsistencia se informa en issues. */
export function toAdminProduct(record: ProductRecord): AdminProductDto {
  const issues: AdminProductIssue[] = []
  const retail = resolvePricing(record, null)
  const wholesale = resolvePricing(record, 'B2B')
  if (retail.retailPrice === null) issues.push('RETAIL_PRICE_INVALID')

  const conditions = record.b2b !== null && typeof record.b2b === 'object' && !Array.isArray(record.b2b) ? record.b2b : null
  const b2bAvailable = typeof conditions?.available === 'boolean' ? conditions.available : null
  const wholesalePrice = validMoney(conditions?.wholesale_price) ? conditions.wholesale_price : null
  const minOrderQuantity = validMoq(conditions?.min_order_quantity) ? conditions.min_order_quantity : null
  const b2bStatus: AdminB2BStatus = b2bAvailable === null ? 'invalid'
    : wholesale.eligible ? 'eligible' : wholesale.issue === 'B2B_NOT_AVAILABLE' ? 'not-available' : 'invalid'
  if (b2bStatus === 'invalid') issues.push('B2B_DATA_INVALID')

  // El MOQ solo condiciona la disponibilidad B2B cuando el producto es elegible.
  const effectiveMoq = wholesale.eligible ? wholesale.minOrderQuantity : null
  const branches: AdminBranchInventory[] = getBranches().map(branch => {
    const inventory = getBranchInventory(record, branch.id)
    const status = inventory.status === 'invalid' || inventory.quantity === null ? 'invalid'
      : inventory.quantity === 0 ? 'out-of-stock'
        : effectiveMoq !== null && inventory.quantity < effectiveMoq ? 'below-moq' : 'available'
    return { branchId: branch.id, name: branch.name, quantity: inventory.quantity, status }
  })

  const quantities = branches.map(branch => branch.quantity)
  const branchTotal = quantities.every(validCount) ? quantities.reduce((sum, quantity) => sum + quantity, 0) : null
  if (branchTotal === null) issues.push('BRANCH_INVENTORY_INVALID')
  const globalStock = validCount(record.stock_quantity) ? record.stock_quantity : null
  if (branchTotal !== null && globalStock !== null && branchTotal !== globalStock) issues.push('STOCK_TOTAL_MISMATCH')
  if (branchTotal !== null && typeof record.in_stock === 'boolean' && record.in_stock !== branchTotal > 0) issues.push('IN_STOCK_FLAG_MISMATCH')

  const stocked = branches.filter(branch => branch.quantity !== null && branch.quantity > 0).length
  const availability = branchTotal === null ? 'invalid' : stocked === 0 ? 'out-of-stock' : stocked === branches.length ? 'available' : 'limited'
  // Sin cuatro cantidades válidas, la ausencia de una sucursal disponible no demuestra insuficiencia global.
  const insufficientForMoq = effectiveMoq !== null && branchTotal !== null && stocked > 0
    && branches.every(branch => branch.status !== 'available')

  return {
    id: record.objectID,
    sku: text(record.sku),
    title: record.title,
    brand: text(record.brand),
    categories: Array.isArray(record.categories) ? record.categories.filter((category): category is string => typeof category === 'string') : [],
    image: text(record.image_url),
    currency: 'CRC',
    pricing: { retailPrice: retail.retailPrice, wholesalePrice, b2bAvailable, minOrderQuantity, b2bStatus },
    inventory: { globalStock, branchTotal, availability, insufficientForMoq, branches },
    issues,
  }
}
