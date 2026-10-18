/** Centraliza las transiciones de items; almacenamiento y presentación pertenecen a otras capas. */
import type { CartAction, CartState } from '../types/cart'

export const cartInitialState: CartState = { items: [] }

/** Aplica transiciones puras e inmutables; conserva líneas únicas y quantity mínima de uno. */
export function cartReducer(state: CartState, action: CartAction): CartState {
  switch (action.type) {
    case 'CLEAR_CART': {
      return state.items.length ? { items: [] } : state
    }
    // Retira solo unidades originales asociadas a la compra aprobada; conserva incorporaciones posteriores.
    // La identidad distingue una línea nueva del mismo producto y los retiros evitan un segundo descuento.
    case 'CLEANUP_PURCHASE': {
      const items = state.items.flatMap((item) => {
        const baseline = action.payload.baseline.find(line => line.productId === item.productId)
        const purchased = action.payload.purchased.find(line => line.productId === item.productId)
        if (!baseline?.lineage || !item.lineage || !purchased
          || baseline.lineage.id !== item.lineage.id) return [item]
        const removedSince = item.lineage.removed - baseline.lineage.removed
        // Retiros consumen primero unidades originales. Nunca atribuir una línea incierta.
        if (!Number.isSafeInteger(removedSince) || removedSince < 0) return [item]
        const quantity = Math.min(item.quantity, Math.max(0,
          Math.min(baseline.quantity, purchased.quantity) - removedSince))
        if (!Number.isSafeInteger(quantity) || quantity <= 0) return [item]
        if (quantity === item.quantity) return []
        const removed = item.lineage.removed + quantity
        return [{ ...item, quantity: item.quantity - quantity,
          lineage: Number.isSafeInteger(removed) ? { ...item.lineage, removed } : undefined }]
      })
      return items.length === state.items.length && items.every((item, index) => item === state.items[index])
        ? state : { items }
    }
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
          ? { ...item, quantity: item.quantity - 1,
              lineage: item.lineage && Number.isSafeInteger(item.lineage.removed + 1)
                ? { ...item.lineage, removed: item.lineage.removed + 1 } : undefined }
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
