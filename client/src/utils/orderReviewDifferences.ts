/** Compara el Cart preliminar con la Order autoritativa y describe las diferencias que requieren aceptación. */
import type { CartItem } from '../types/cart'
import type { Order } from '../types/order'
import { calculateCartTotals, calculateLineSubtotal } from './cartCalculations'

/** Compara valores originales, nunca importes redondeados para presentación. */
export function orderReviewDifferences(items: readonly CartItem[], order: Order): string[] {
  const differences: string[] = []
  const remaining = [...order.items]
  const number = new Intl.NumberFormat('es-CR', { maximumSignificantDigits: 21 })
  /** Añade una descripción de la diferencia entre valores numéricos; no usa el formato visual para decidir igualdad. */
  function compare(label: string, before: number, after: number, money = true) {
    if (before === after) return
    /** Presenta el valor de la diferencia con precisión significativa y símbolo monetario cuando corresponde. */
    const format = (value: number) => `${money ? '₡' : ''}${number.format(value)}`
    differences.push(`${label}: antes ${format(before)}; ahora ${format(after)}.`)
  }
  for (const item of items) {
    const index = remaining.findIndex(candidate => candidate.productId === item.productId)
    if (index < 0) {
      differences.push(`Producto retirado: ${item.name}.`)
      continue
    }
    const [updated] = remaining.splice(index, 1)
    compare(`Cantidad de ${item.name}`, item.quantity, updated.quantity, false)
    compare(`Precio unitario de ${item.name}`, item.price, updated.unitPrice)
    compare(`Subtotal de ${item.name}`, calculateLineSubtotal(item.price, item.quantity), updated.lineSubtotal)
  }
  for (const item of remaining) differences.push(`Producto añadido: ${item.name} (cantidad ${item.quantity}).`)
  const preliminary = calculateCartTotals(items)
  const labels = { subtotal: 'Subtotal', tax: 'IVA', shipping: 'Envío', total: 'Total' } as const
  for (const key of ['subtotal', 'tax', 'shipping', 'total'] as const) {
    compare(labels[key], preliminary[key], order.totals[key])
  }
  return differences
}
