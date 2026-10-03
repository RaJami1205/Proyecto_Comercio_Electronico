import { useEffect, useReducer, type ReactNode } from 'react'
import { CartContext, type CartContextValue } from './CartContext'
import { cartInitialState, cartReducer } from './cartReducer'
import { CART_STORAGE_KEY, loadCart, parseStoredCart, saveCart } from '../utils/cartStorage'

interface CartProviderProps {
  children: ReactNode
}


function CartProvider({ children }: CartProviderProps) {
  // CN-11: loadCart es el inicializador de useReducer. Recupera el carrito desde
  // localStorage en el primer render, antes de pintar, sin efectos dentro del reducer.
  const [state, dispatch] = useReducer(cartReducer, cartInitialState, loadCart)

  // CN-11: cada cambio de items se guarda.
  useEffect(() => {
    saveCart(state)
  }, [state])

  // CN-11: si el usuario tiene la tienda abierta en otra pestaña, el evento storage
  // sincroniza este carrito con el guardado más reciente.
  useEffect(() => {
    function handleStorage(event: StorageEvent) {
      if (event.key !== CART_STORAGE_KEY) return
      dispatch({ type: 'HYDRATE', payload: { items: parseStoredCart(event.newValue) ?? [] } })
    }

    window.addEventListener('storage', handleStorage)
    return () => window.removeEventListener('storage', handleStorage)
  }, [])

  // Las operaciones públicas encapsulan dispatch para que los consumidores no dependan de las actions.
  const value: CartContextValue = {
    items: state.items,
    addItem: (item) => dispatch({ type: 'ADD_ITEM', payload: item }),
    incrementItem: (productId) => dispatch({ type: 'INCREMENT_ITEM', payload: { productId } }),
    decrementItem: (productId) => dispatch({ type: 'DECREMENT_ITEM', payload: { productId } }),
    removeItem: (productId) => dispatch({ type: 'REMOVE_ITEM', payload: { productId } }),
    // totalUnits es derived state: suma quantity y no debe añadirse a CartState.
    // CN-13: CartIndicator debe consumir este valor, sin mantener otro contador independiente.
    totalUnits: state.items.reduce((sum, item) => sum + item.quantity, 0),
  }

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>
}

export default CartProvider