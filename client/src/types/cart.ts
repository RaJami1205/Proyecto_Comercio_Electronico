// CartItem conserva el snapshot mínimo de un Product necesario para el carrito, no el Product completo.
// Cada productId identifica una única línea del carrito.
export interface CartItem {
  productId: string
  name: string
  price: number
  image: string
  // quantity pertenece al estado del carrito: el reducer la gestiona y mantiene siempre >= 1.
  quantity: number
}

// items es la única fuente de verdad del CartState; el estado de UI se mantiene separado.
// totalUnits, subtotal, IVA, shipping y total no deben almacenarse aquí como fuentes independientes.
export interface CartState {
  items: CartItem[]
}

export type CartAction =
  | { type: 'ADD_ITEM'; payload: Omit<CartItem, 'quantity'> }
  | { type: 'INCREMENT_ITEM'; payload: { productId: string } }
  | { type: 'DECREMENT_ITEM'; payload: { productId: string } }
  | { type: 'REMOVE_ITEM'; payload: { productId: string } }
  // CN-11: reemplaza los items con un carrito ya validado (p. ej. cambios desde otra pestaña).
  | { type: 'HYDRATE'; payload: { items: CartItem[] } }