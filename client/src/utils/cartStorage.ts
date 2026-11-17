/** Aísla la persistencia del Cart en localStorage y valida los items antes de restaurarlos. */
import type { CartItem, CartState } from '../types/cart'

export const CART_STORAGE_KEY = 'cibernova:cart:v1'

// Forma del objeto que se guarda. Solo contiene items: subtotal, IVA, envío y total
// son derived state y se recalculan con cartCalculations al recuperar el carrito
interface PersistedCart {
  items: CartItem[]
}

export interface CartStorageEnvelope {
  items: CartItem[]
  ownerId: string | null
  valid: boolean
  legacy: boolean
}

/** Recupera identidad y retiros válidos de un valor desconocido; devuelve undefined si no puede validarlos. */
function parseLineage(value: unknown): CartItem['lineage'] {
  if (typeof value !== 'object' || value === null) return undefined
  const lineage = value as Record<string, unknown>
  return typeof lineage.id === 'string' && lineage.id.length > 0
    && typeof lineage.removed === 'number' && Number.isSafeInteger(lineage.removed) && lineage.removed >= 0
    ? { id: lineage.id, removed: lineage.removed } : undefined
}

/** Valida el snapshot mínimo, precio finito y quantity entera positiva antes de hidratar. */
function isValidCartItem(value: unknown): value is CartItem {
  if (typeof value !== 'object' || value === null) return false
  const item = value as Record<string, unknown>

  return (
    typeof item.productId === 'string' && item.productId.length > 0 &&
    typeof item.name === 'string' &&
    typeof item.image === 'string' &&
    // El precio debe ser un número real no negativo
    typeof item.price === 'number' && Number.isFinite(item.price) && item.price >= 0 &&
    // Respeta la regla del reducer: quantity es entera y nunca menor que 1.
    typeof item.quantity === 'number' && Number.isSafeInteger(item.quantity) && item.quantity >= 1 &&
    (item.retailPrice === undefined || item.retailPrice === null || typeof item.retailPrice === 'number' && Number.isFinite(item.retailPrice) && item.retailPrice >= 0) &&
    (item.pricingType === undefined || item.pricingType === null || item.pricingType === 'RETAIL' || item.pricingType === 'WHOLESALE') &&
    (item.minimumOrderQuantity === undefined || Number.isSafeInteger(item.minimumOrderQuantity) && Number(item.minimumOrderQuantity) >= 1) &&
    (item.branchId === undefined || item.branchId === null || typeof item.branchId === 'string' && ['san_jose', 'alajuela', 'cartago', 'heredia'].includes(item.branchId)) &&
    (item.availableQuantity === undefined || item.availableQuantity === null || Number.isSafeInteger(item.availableQuantity) && Number(item.availableQuantity) >= 0) &&
    (item.inventoryStatus === undefined || ['unselected', 'available', 'out-of-stock', 'invalid'].includes(String(item.inventoryStatus))) &&
    (item.commercialEligible === undefined || typeof item.commercialEligible === 'boolean')
  )
}

/** Recupera items válidos y combina duplicados; devuelve null ante un formato general inválido. */
export function parseStoredCart(raw: string | null): CartItem[] | null {
  if (raw === null) return null

  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return null

    const items = (parsed as Partial<PersistedCart>).items
    if (!Array.isArray(items)) return null

    const byProductId = new Map<string, CartItem>()
    for (const candidate of items) {
      if (!isValidCartItem(candidate)) continue
      const existing = byProductId.get(candidate.productId)
      if (existing && !Number.isSafeInteger(existing.quantity + candidate.quantity)) return null
      byProductId.set(
        candidate.productId,
        existing
          // Duplicados no permiten demostrar la identidad original: descartar solo metadatos.
          ? { ...existing, quantity: existing.quantity + candidate.quantity, lineage: undefined }
          : {
              productId: candidate.productId,
              name: candidate.name,
              price: candidate.price,
              image: candidate.image,
              quantity: candidate.quantity,
              ...(candidate.retailPrice !== undefined ? { retailPrice: candidate.retailPrice } : {}),
              ...(candidate.pricingType !== undefined ? { pricingType: candidate.pricingType } : {}),
              ...(candidate.minimumOrderQuantity !== undefined ? { minimumOrderQuantity: candidate.minimumOrderQuantity } : {}),
              ...(candidate.branchId !== undefined ? { branchId: candidate.branchId } : {}),
              ...(candidate.availableQuantity !== undefined ? { availableQuantity: candidate.availableQuantity } : {}),
              ...(candidate.inventoryStatus !== undefined ? { inventoryStatus: candidate.inventoryStatus } : {}),
              ...(candidate.commercialEligible !== undefined ? { commercialEligible: candidate.commercialEligible } : {}),
              ...(parseLineage(candidate.lineage) ? { lineage: parseLineage(candidate.lineage) } : {}),
            },
      )
    }

    return [...byProductId.values()]
  } catch {
    return null
  }
}

/** Restaura items válidos o conserva el fallback si el almacenamiento no está disponible. */
export function loadCart(fallback: CartState): CartState {
  try {
    const items = parseStoredCart(window.localStorage.getItem(CART_STORAGE_KEY))
    return items ? { items } : fallback
  } catch {
    // localStorage puede lanzar en modo privado o con el almacenamiento bloqueado.
    return fallback
  }
}

/** Lee ownership sin asignar una identidad a snapshots legacy o inválidos. */
export function loadCartEnvelope(): CartStorageEnvelope {
  try {
    const raw = window.localStorage.getItem(CART_STORAGE_KEY)
    if (raw === null) return { items: [], ownerId: null, valid: true, legacy: false }
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return { items: [], ownerId: null, valid: false, legacy: false }
    const value = parsed as Record<string, unknown>
    if (!Array.isArray(value.items) || value.items.some(candidate => !isValidCartItem(candidate))) return { items: [], ownerId: null, valid: false, legacy: false }
    const items = parseStoredCart(raw)
    if (items === null) return { items: [], ownerId: null, valid: false, legacy: false }
    if (value.schemaVersion === undefined) return { items, ownerId: null, valid: true, legacy: true }
    if (value.schemaVersion !== 2 || !(value.ownerId === null || typeof value.ownerId === 'string'
      && /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(value.ownerId))) {
      return { items: [], ownerId: null, valid: false, legacy: false }
    }
    return { items, ownerId: value.ownerId, valid: true, legacy: false }
  } catch {
    return { items: [], ownerId: null, valid: false, legacy: false }
  }
}

/** Guarda únicamente items; un fallo de almacenamiento no interrumpe el Cart en memoria. */
export function saveCart(state: CartState, ownerId?: string | null): void {
  try {
    const payload = ownerId === undefined ? { items: state.items } satisfies PersistedCart
      : { schemaVersion: 2, ownerId, items: state.items }
    window.localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(payload))
  } catch {
    // Cuota llena o almacenamiento deshabilitado: el carrito sigue funcionando en memoria.
  }
}
