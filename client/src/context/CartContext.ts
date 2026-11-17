/** Define la frontera tipada entre el Cart compartido y sus consumidores mediante useCart. */
import { createContext } from 'react'
import type { CartItem, CartPurchaseCleanup } from '../types/cart'

/** Resultado de la transición real del Cart, independiente del siguiente render de React. */
export type CartAddResult = { accepted: true } | { accepted: false; message: string }

// Contrato público compartido: separa los detalles internos del estado de sus componentes consumidores.
// Se consume mediante useCart(), sin acceder al reducer; dispatch permanece interno al Provider.
export interface CartContextValue {
  items: CartItem[]
  hasExternalConflict: boolean
  ownerId: string | null
  activeOwnerId: string | null
  isActive: boolean
  hasInvalidStorage: boolean
  getSnapshot: () => { items: readonly CartItem[]; ownerId: string | null; revision: number; hasExternalConflict: boolean }
  setCartOwner: (ownerId: string | null, adoptUnowned?: boolean) => boolean
  updateProductContext: (productId: string, context: Partial<CartItem>) => void
  addItem: (item: Omit<CartItem, 'quantity'> & { initialQuantity?: number }) => CartAddResult
  incrementItem: (productId: string) => void
  decrementItem: (productId: string) => void
  removeItem: (productId: string) => void
  clearCart: () => void
  cleanupPurchase: (purchase: CartPurchaseCleanup) => void
  totalUnits: number
}

export const CartContext = createContext<CartContextValue | undefined>(undefined)
