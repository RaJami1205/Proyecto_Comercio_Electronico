import { useReducer, type ReactNode } from 'react'
import { CartContext, type CartContextValue } from './CartContext'
import { cartInitialState, cartReducer } from './cartReducer'

interface CartProviderProps {
  children: ReactNode
}

// Posee la instancia global del CartState: montado alrededor de App, comparte el mismo carrito con todos sus consumidores.
function CartProvider({ children }: CartProviderProps) {
  // CN-6 mantiene el estado en memoria. CN-11 incorporará localStorage e hidratación;
  // la persistencia y cualquier side effect futuro deben permanecer fuera del reducer.
  const [state, dispatch] = useReducer(cartReducer, cartInitialState)
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
