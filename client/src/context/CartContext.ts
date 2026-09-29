import { createContext } from 'react'
import type { CartItem } from '../types/cart'
import type { Product } from '../types/product'

export type CartFeedbackSource = 'catalog' | 'quick-view'

export interface CartAddFeedback {
  id: number
  productId: string
  productName: string
  source: CartFeedbackSource
}

// Contrato público compartido: separa los detalles internos del estado de sus componentes consumidores.
// Se consume mediante useCart(), sin acceder al reducer; dispatch permanece interno al Provider.
export interface CartContextValue {
  items: CartItem[]
  productDetailsById: Record<string, Product>
  addItem: (
    item: Omit<CartItem, 'quantity'>,
    source?: CartFeedbackSource,
    productDetails?: Product,
  ) => void
  cartAddFeedback: CartAddFeedback | null
  incrementItem: (productId: string) => void
  decrementItem: (productId: string) => void
  removeItem: (productId: string) => void
  totalUnits: number
}

export const CartContext = createContext<CartContextValue | undefined>(undefined)
