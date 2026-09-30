import type { CartItem } from '../types/cart'

const VAT_RATE = 0.13
const STANDARD_SHIPPING_FEE = 3500
const FREE_SHIPPING_THRESHOLD = 100000

export function calculateLineSubtotal(price: number, quantity: number): number {
  return price * quantity
}

export function calculateCartTotals(items: readonly CartItem[]) {
  const subtotal = items.reduce(
    (sum, item) => sum + calculateLineSubtotal(item.price, item.quantity),
    0,
  )
  const tax = subtotal * VAT_RATE

  // CN-17 evalúa el subtotal antes de IVA y sin redondeos de presentación.
  let shipping = 0
  if (subtotal > 0 && subtotal < FREE_SHIPPING_THRESHOLD) {
    shipping = STANDARD_SHIPPING_FEE
  }

  return { subtotal, tax, shipping, total: subtotal + tax + shipping }
}
