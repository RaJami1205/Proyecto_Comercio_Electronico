import type { CartAction, CartState } from '../types/cart'

export const cartInitialState: CartState = { items: [] }

// El reducer debe permanecer puro: no mutar state ni payloads, ni ejecutar side effects,
// acceder a localStorage o realizar requests. CN-9 debe operar desde useCart en
// CartPage / CartItem UI, sin modificar items directamente.
export function cartReducer(state: CartState, action: CartAction): CartState {
  switch (action.type) {
    case 'ADD_ITEM': {
      const existing = state.items.find((item) => item.productId === action.payload.productId)
      // ADD_ITEM crea una línea con quantity = 1 o incrementa la existente conservando su snapshot.
      // Así cada productId mantiene una sola línea, sin duplicados.
      return {
        items: existing
          ? state.items.map((item) => item.productId === action.payload.productId
            ? { ...item, quantity: item.quantity + 1 }
            : item)
          : [...state.items, { ...action.payload, quantity: 1 }],
      }
    }
    case 'INCREMENT_ITEM': {
      // Solo se incrementan líneas existentes; un productId desconocido no crea una línea.
      if (!state.items.some((item) => item.productId === action.payload.productId)) return state
      return {
        items: state.items.map((item) => item.productId === action.payload.productId
          ? { ...item, quantity: item.quantity + 1 }
          : item),
      }
    }
    case 'DECREMENT_ITEM': {
      const existing = state.items.find((item) => item.productId === action.payload.productId)
      // quantity nunca baja de 1: DECREMENT_ITEM no elimina; REMOVE_ITEM es la eliminación explícita.
      if (!existing || existing.quantity <= 1) return state
      return {
        items: state.items.map((item) => item.productId === action.payload.productId
          ? { ...item, quantity: item.quantity - 1 }
          : item),
      }
    }
    case 'REMOVE_ITEM': {
      if (!state.items.some((item) => item.productId === action.payload.productId)) return state
      return { items: state.items.filter((item) => item.productId !== action.payload.productId) }
    }
    case 'HYDRATE': {
      // Recibe items ya validados por cartStorage; el reducer no lee localStorage.
      return { items: action.payload.items }
    }
  }
}
