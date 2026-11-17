/** Mantiene la instancia compartida del Cart y coordina cartStorage fuera del reducer. */
import { useCallback, useEffect, useReducer, useRef, useState, type ReactNode } from 'react'
import { CartContext, type CartContextValue } from './CartContext'
import { cartInitialState, cartReducer } from './cartReducer'
import { CART_STORAGE_KEY, loadCartEnvelope, saveCart } from '../utils/cartStorage'
import type { CartAction, CartItem, CartPurchaseCleanup } from '../types/cart'

// Migración conservadora: sin identidad previa no se atribuye una línea a un Checkout anterior.
function identifyItems(items: CartItem[]): CartItem[] {
  return items.map(item => item.lineage ? item : { ...item, lineage: { id: crypto.randomUUID(), removed: 0 } })
}

const storageOwnerPattern = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/

interface CartProviderProps {
  children: ReactNode
}


/** Expone la API pública y totalUnits derivado, restaurando y guardando items. */
function CartProvider({ children }: CartProviderProps) {
  // CN-11: loadCartEnvelope se evalúa al montar. Recupera el carrito desde
  // localStorage antes de pintar; el reducer continúa siendo una transición pura.
  const [envelope] = useState(loadCartEnvelope)
  const [state, dispatch] = useReducer(cartReducer, {
    items: identifyItems(envelope.valid ? envelope.items : cartInitialState.items),
  })
  const [ownerId, setOwnerId] = useState<string | null>(envelope.ownerId)
  const [activeOwnerId, setActiveOwnerId] = useState<string | null>(null)
  const current = useRef(state)
  const ownerRef = useRef(ownerId)
  const activeOwnerRef = useRef(activeOwnerId)
  const revision = useRef(0)
  const [hasInvalidStorage, setHasInvalidStorage] = useState(!envelope.valid)
  const [hasExternalConflict, setHasExternalConflict] = useState(!envelope.valid)
  const conflict = useRef(!envelope.valid)
  const isActive = ownerId === null ? activeOwnerId === null : activeOwnerId === ownerId
  // La misma función pura calcula el snapshot inmediato y el siguiente estado de React.
  const dispatchCart = useCallback((action: CartAction) => {
    const next = cartReducer(current.current, action)
    if (next !== current.current) revision.current += 1
    current.current = next
    dispatch(action)
  }, [])
  const getSnapshot = useCallback(() => ({ items: current.current.items, ownerId: ownerRef.current, revision: revision.current,
    hasExternalConflict: conflict.current }), [])

  /** Activa el carrito validado del usuario; reclamar uno anónimo requiere consentimiento explícito. */
  const setCartOwner = useCallback((nextOwnerId: string | null, adoptUnowned = false): boolean => {
    if (nextOwnerId === null) {
      activeOwnerRef.current = null
      setActiveOwnerId(null)
      return true
    }
    if (!storageOwnerPattern.test(nextOwnerId)) return false
    if (ownerRef.current !== null && ownerRef.current !== nextOwnerId && current.current.items.length > 0) return false
    if (ownerRef.current === null && current.current.items.length > 0 && !adoptUnowned) return false
    ownerRef.current = nextOwnerId
    activeOwnerRef.current = nextOwnerId
    setOwnerId(nextOwnerId)
    setActiveOwnerId(nextOwnerId)
    return true
  }, [])

  /** Actualiza únicamente el contexto actual validado por Server; conserva cantidad y lineage. */
  const updateProductContext = useCallback((productId: string, context: Partial<CartItem>) => {
    if (activeOwnerRef.current !== ownerRef.current) return
    const safeContext: Partial<CartItem> = { ...context }
    delete safeContext.productId
    delete safeContext.quantity
    delete safeContext.lineage
    dispatchCart({ type: 'UPDATE_PRODUCT_CONTEXT', payload: { productId, ...safeContext } })
  }, [dispatchCart])

  // CN-11: cada cambio de items se guarda.
  useEffect(() => {
    if (!hasInvalidStorage) saveCart(state, ownerId)
  }, [state, ownerId, hasInvalidStorage])

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
    setHasInvalidStorage(false)
    // También guarda vacío si el reducer ya estaba vacío y el conflicto era externo.
    saveCart({ items: [] }, ownerRef.current)
  }, [dispatchCart])
  /** Envía el baseline y las cantidades compradas al reducer para limpiar sobre el Cart vigente. */
  const cleanupPurchase = useCallback((purchase: CartPurchaseCleanup) => {
    if (purchase.ownerId && (purchase.ownerId !== ownerRef.current || purchase.ownerId !== activeOwnerRef.current)) return
    dispatchCart({ type: 'CLEANUP_PURCHASE', payload: purchase })
  }, [dispatchCart])

  // Las operaciones públicas encapsulan dispatch para que los consumidores no dependan de las actions.
  const value: CartContextValue = {
    items: isActive ? state.items : [],
    hasExternalConflict,
    ownerId,
    activeOwnerId,
    isActive,
    hasInvalidStorage,
    getSnapshot,
    setCartOwner,
    updateProductContext,
    clearCart,
    cleanupPurchase,
    addItem: (item) => {
      if (!isActive) return
      const { initialQuantity = 1, ...snapshot } = item as typeof item & { initialQuantity?: number }
      const existing = current.current.items.find(value => value.productId === snapshot.productId)
      if (existing) {
        if (existing.availableQuantity !== undefined && existing.availableQuantity !== null && existing.quantity >= existing.availableQuantity) return
        dispatchCart({ type: 'ADD_ITEM', payload: { ...snapshot, initialQuantity: 1, lineage: existing.lineage } })
        return
      }
      if (!Number.isSafeInteger(initialQuantity) || initialQuantity < (snapshot.minimumOrderQuantity ?? 1)
        || snapshot.availableQuantity !== undefined && snapshot.availableQuantity !== null && initialQuantity > snapshot.availableQuantity) return
      dispatchCart({ type: 'ADD_ITEM', payload: {
        ...snapshot, initialQuantity, lineage: { id: crypto.randomUUID(), removed: 0 },
      } })
    },
    incrementItem: (productId) => {
      if (!isActive) return
      const item = current.current.items.find(value => value.productId === productId)
      if (!item || item.availableQuantity !== undefined && item.availableQuantity !== null && item.quantity >= item.availableQuantity) return
      dispatchCart({ type: 'INCREMENT_ITEM', payload: { productId } })
    },
    decrementItem: (productId) => {
      if (!isActive) return
      const item = current.current.items.find(value => value.productId === productId)
      if (!item || item.quantity <= Math.max(1, item.minimumOrderQuantity ?? 1)) return
      dispatchCart({ type: 'DECREMENT_ITEM', payload: { productId } })
    },
    removeItem: (productId) => { if (isActive) dispatchCart({ type: 'REMOVE_ITEM', payload: { productId } }) },
    // totalUnits es derived state: suma quantity y no debe añadirse a CartState.
    // CN-13: CartIndicator debe consumir este valor, sin mantener otro contador independiente.
    totalUnits: (isActive ? state.items : []).reduce((sum, item) => sum + item.quantity, 0),
  }

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>
}

export default CartProvider
