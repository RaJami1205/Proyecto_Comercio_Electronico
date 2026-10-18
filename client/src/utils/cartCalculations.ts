/** Contiene cálculos puros de subtotal, tax, shipping y total como derived values, sin modificar CartState. */
import type { CartItem } from '../types/cart'

const VAT_RATE = 0.13
const STANDARD_SHIPPING_FEE = 3500
const FREE_SHIPPING_THRESHOLD = 100000

/** Obtiene el importe de una línea sin redondeos de presentación. */
export function calculateLineSubtotal(price: number, quantity: number): number {
  return price * quantity
}

/** Deriva el desglose desde items y aplica CN-17 sobre el subtotal anterior al IVA. */
export function calculateCartTotals(items: readonly CartItem[]) {
  const subtotal = items.reduce(
    (sum, item) => sum + calculateLineSubtotal(item.price, item.quantity),
    0,
  )
  // Mismo redondeo a centavos y orden de operaciones que el Server.
  const tax = Math.round(subtotal * 100 * VAT_RATE) / 100

  // Redondea la suma completa a CRC enteros solo para elegibilidad, antes del IVA.
  let shipping = 0
  if (subtotal > 0 && Math.round(subtotal) < FREE_SHIPPING_THRESHOLD) {
    shipping = STANDARD_SHIPPING_FEE
  }

  return { subtotal, tax, shipping, total: subtotal + tax + shipping }
}
