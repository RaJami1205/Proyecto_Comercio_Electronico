import { useEffect, useReducer, useRef, useState, type ReactNode } from 'react'
import { CartContext, type CartContextValue } from './CartContext'
import type { CartFeedbackSource } from './CartContext'
import { cartReducer } from './cartReducer'
import type { CartItem, CartState } from '../types/cart'
import type { Product } from '../types/product'

interface CartProviderProps {
  children: ReactNode
}

interface StoredCart {
  items: CartItem[]
  productDetailsById: Record<string, Product>
}

const CART_STORAGE_KEY = 'cibernova.cart.v1'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isCartItem(value: unknown): value is CartItem {
  if (!isRecord(value)) return false

  return typeof value.productId === 'string'
    && typeof value.name === 'string'
    && typeof value.image === 'string'
    && typeof value.price === 'number'
    && Number.isFinite(value.price)
    && value.price >= 0
    && typeof value.quantity === 'number'
    && Number.isInteger(value.quantity)
    && value.quantity >= 1
}

function isProduct(value: unknown): value is Product {
  if (!isRecord(value)) return false

  return typeof value.id === 'string'
    && typeof value.name === 'string'
    && typeof value.image === 'string'
    && typeof value.price === 'number'
    && Number.isFinite(value.price)
    && value.price >= 0
    && typeof value.inStock === 'boolean'
    && typeof value.category === 'string'
    && typeof value.description === 'string'
    && Array.isArray(value.specifications)
    && value.specifications.every((specification: unknown) =>
      isRecord(specification)
      && typeof specification.label === 'string'
      && typeof specification.value === 'string',
    )
}

function readStoredCart(): StoredCart {
  const emptyCart: StoredCart = { items: [], productDetailsById: {} }

  try {
    if (typeof window === 'undefined') return emptyCart

    const serializedCart = window.localStorage.getItem(CART_STORAGE_KEY)
    if (!serializedCart) return emptyCart

    const parsedCart: unknown = JSON.parse(serializedCart)
    if (!isRecord(parsedCart)) return emptyCart

    const items: CartItem[] = []
    const productIds = new Set<string>()
    if (Array.isArray(parsedCart.items)) {
      for (const candidate of parsedCart.items) {
        if (isCartItem(candidate) && !productIds.has(candidate.productId)) {
          items.push(candidate)
          productIds.add(candidate.productId)
        }
      }
    }

    const productDetailsById: Record<string, Product> = {}
    if (isRecord(parsedCart.productDetailsById)) {
      for (const [productId, candidate] of Object.entries(parsedCart.productDetailsById)) {
        if (productIds.has(productId) && isProduct(candidate) && candidate.id === productId) {
          productDetailsById[productId] = candidate
        }
      }
    }

    return { items, productDetailsById }
  } catch {
    return emptyCart
  }
}

// Posee la instancia global del CartState: montado alrededor de App, comparte el mismo carrito con todos sus consumidores.
function CartProvider({ children }: CartProviderProps) {
  const [storedCart] = useState(readStoredCart)
  const [state, dispatch] = useReducer(cartReducer, { items: storedCart.items } satisfies CartState)
  const [cartAddFeedback, setCartAddFeedback] = useState<CartContextValue['cartAddFeedback']>(null)
  const [productDetailsById, setProductDetailsById] = useState(storedCart.productDetailsById)
  const feedbackIdRef = useRef(0)
  const feedbackTimeoutRef = useRef<number | null>(null)

  useEffect(() => () => {
    if (feedbackTimeoutRef.current !== null) {
      window.clearTimeout(feedbackTimeoutRef.current)
    }
  }, [])

  useEffect(() => {
    try {
      window.localStorage.setItem(
        CART_STORAGE_KEY,
        JSON.stringify({ items: state.items, productDetailsById }),
      )
    } catch {
      // El carrito continúa funcionando en memoria si el navegador bloquea el almacenamiento.
    }
  }, [state.items, productDetailsById])

  // Las operaciones públicas encapsulan dispatch para que los consumidores no dependan de las actions.
  const value: CartContextValue = {
    items: state.items,
    cartAddFeedback,
    productDetailsById,
    addItem: (item, source: CartFeedbackSource = 'catalog', productDetails) => {
      dispatch({ type: 'ADD_ITEM', payload: item })
      if (productDetails) {
        setProductDetailsById((current) => ({
          ...current,
          [productDetails.id]: productDetails,
        }))
      }
      setCartAddFeedback({
        id: ++feedbackIdRef.current,
        productId: item.productId,
        productName: item.name,
        source,
      })

      if (feedbackTimeoutRef.current !== null) {
        window.clearTimeout(feedbackTimeoutRef.current)
      }

      feedbackTimeoutRef.current = window.setTimeout(() => {
        setCartAddFeedback(null)
        feedbackTimeoutRef.current = null
      }, 2500)
    },
    incrementItem: (productId) => dispatch({ type: 'INCREMENT_ITEM', payload: { productId } }),
    decrementItem: (productId) => dispatch({ type: 'DECREMENT_ITEM', payload: { productId } }),
    removeItem: (productId) => {
      dispatch({ type: 'REMOVE_ITEM', payload: { productId } })
      setProductDetailsById((current) => {
        if (!current[productId]) return current
        const updated = { ...current }
        delete updated[productId]
        return updated
      })
    },
    // totalUnits es derived state: suma quantity y no debe añadirse a CartState.
    // CN-13: CartIndicator debe consumir este valor, sin mantener otro contador independiente.
    totalUnits: state.items.reduce((sum, item) => sum + item.quantity, 0),
  }

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>
}

export default CartProvider
