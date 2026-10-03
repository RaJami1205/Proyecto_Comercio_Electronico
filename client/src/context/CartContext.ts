/** Define la frontera tipada entre el Cart compartido y sus consumidores mediante useCart. */
import { createContext } from 'react'
import type { CartItem } from '../types/cart'

// Contrato público compartido: separa los detalles internos del estado de sus componentes consumidores.
// Se consume mediante useCart(), sin acceder al reducer; dispatch permanece interno al Provider.
export interface CartContextValue {
  items: CartItem[]
  addItem: (item: Omit<CartItem, 'quantity'>) => void
  incrementItem: (productId: string) => void
  decrementItem: (productId: string) => void
  removeItem: (productId: string) => void
  totalUnits: number
}

export const CartContext = createContext<CartContextValue | undefined>(undefined)
