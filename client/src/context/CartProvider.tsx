/** Mantiene la instancia compartida del Cart y coordina cartStorage fuera del reducer. */
import { useCallback, useEffect, useReducer, useRef, useState, type ReactNode } from 'react'
import { CartContext, type CartContextValue } from './CartContext'
import { cartInitialState, cartReducer } from './cartReducer'
import { CART_STORAGE_KEY, loadCart, saveCart } from '../utils/cartStorage'
import type { CartAction, CartItem, CartPurchaseCleanup } from '../types/cart'

// Migración conservadora: sin identidad previa no se atribuye una línea a un Checkout anterior.
function identifyItems(items: CartItem[]): CartItem[] {
  return items.map(item => item.lineage ? item : { ...item, lineage: { id: crypto.randomUUID(), removed: 0 } })
}

interface CartProviderProps {
  children: ReactNode
}


/** Expone la API pública y totalUnits derivado, restaurando y guardando items. */
function CartProvider({ children }: CartProviderProps) {
  // CN-11: loadCart es el inicializador de useReducer. Recupera el carrito desde
  // localStorage en el primer render, antes de pintar, sin efectos dentro del reducer.
  const [state, dispatch] = useReducer(cartReducer, cartInitialState,
    initial => ({ items: identifyItems(loadCart(initial).items) }))
  const current = useRef(state)
  const revision = useRef(0)
  const conflict = useRef(false)
  const [hasExternalConflict, setHasExternalConflict] = useState(false)
  // La misma función pura calcula el snapshot inmediato y el siguiente estado de React.
  const dispatchCart = useCallback((action: CartAction) => {
    const next = cartReducer(current.current, action)
    if (next !== current.current) revision.current += 1
    current.current = next
    dispatch(action)
  }, [])
  const getSnapshot = useCallback(() => ({ items: current.current.items, revision: revision.current,
    hasExternalConflict: conflict.current }), [])

  // CN-11: cada cambio de items se guarda.
  useEffect(() => {
    saveCart(state)
  }, [state])

  // CN-53: la clave sigue compartida. Un cambio externo no demuestra ownership;
  // conservar la copia local y exigir resolución explícita, sin importar productos ajenos.
  useEffect(() => {
    /** También detecta localStorage.clear(), cuyo evento tiene key null. */
    function handleStorage(event: StorageEvent) {
      if (event.key !== CART_STORAGE_KEY && event.key !== null) return
      conflict.current = true
      revision.current += 1
      setHasExternalConflict(true)
    }

    window.addEventListener('storage', handleStorage)
    return () => window.removeEventListener('storage', handleStorage)
  }, [])

  /** Solicita el vaciado explícito del carrito mediante una única acción del reducer. */
  const clearCart = useCallback(() => {
    dispatchCart({ type: 'CLEAR_CART' })
    conflict.current = false
    revision.current += 1
    setHasExternalConflict(false)
    // También guarda vacío si el reducer ya estaba vacío y el conflicto era externo.
    saveCart({ items: [] })
  }, [dispatchCart])
  /** Envía el baseline y las cantidades compradas al reducer para limpiar sobre el Cart vigente. */
  const cleanupPurchase = useCallback((purchase: CartPurchaseCleanup) =>
    dispatchCart({ type: 'CLEANUP_PURCHASE', payload: purchase }), [dispatchCart])

  // Las operaciones públicas encapsulan dispatch para que los consumidores no dependan de las actions.
  const value: CartContextValue = {
    items: state.items,
    hasExternalConflict,
    getSnapshot,
    clearCart,
    cleanupPurchase,
    addItem: (item) => dispatchCart({ type: 'ADD_ITEM', payload: {
      ...item, lineage: { id: crypto.randomUUID(), removed: 0 },
    } }),
    incrementItem: (productId) => dispatchCart({ type: 'INCREMENT_ITEM', payload: { productId } }),
    decrementItem: (productId) => dispatchCart({ type: 'DECREMENT_ITEM', payload: { productId } }),
    removeItem: (productId) => dispatchCart({ type: 'REMOVE_ITEM', payload: { productId } }),
    // totalUnits es derived state: suma quantity y no debe añadirse a CartState.
    // CN-13: CartIndicator debe consumir este valor, sin mantener otro contador independiente.
    totalUnits: state.items.reduce((sum, item) => sum + item.quantity, 0),
  }

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>
}

export default CartProvider
