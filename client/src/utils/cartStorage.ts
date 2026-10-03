/** Aísla la persistencia del Cart en localStorage y valida los items antes de restaurarlos. */
import type { CartItem, CartState } from '../types/cart'

export const CART_STORAGE_KEY = 'cibernova:cart:v1'

// Forma del objeto que se guarda. Solo contiene items: subtotal, IVA, envío y total
// son derived state y se recalculan con cartCalculations al recuperar el carrito
interface PersistedCart {
  items: CartItem[]
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
    typeof item.quantity === 'number' && Number.isInteger(item.quantity) && item.quantity >= 1
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
      byProductId.set(
        candidate.productId,
        existing
          ? { ...existing, quantity: existing.quantity + candidate.quantity }
          : {
              productId: candidate.productId,
              name: candidate.name,
              price: candidate.price,
              image: candidate.image,
              quantity: candidate.quantity,
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

/** Guarda únicamente items; un fallo de almacenamiento no interrumpe el Cart en memoria. */
export function saveCart(state: CartState): void {
  try {
    const payload: PersistedCart = { items: state.items }
    window.localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(payload))
  } catch {
    // Cuota llena o almacenamiento deshabilitado: el carrito sigue funcionando en memoria.
  }
}