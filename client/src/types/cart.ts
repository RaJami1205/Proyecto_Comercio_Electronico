// CartItem conserva el snapshot mínimo de un Product necesario para el carrito, no el Product completo.
// Cada productId identifica una única línea del carrito.
export interface CartItem {
  productId: string
  name: string
  price: number
  image: string
  retailPrice?: number | null
  pricingType?: 'RETAIL' | 'WHOLESALE' | null
  minimumOrderQuantity?: number
  branchId?: import('./branch').BranchId | null
  availableQuantity?: number | null
  inventoryStatus?: 'unselected' | 'available' | 'out-of-stock' | 'invalid'
  commercialEligible?: boolean
  // quantity pertenece al estado del carrito: el reducer la gestiona y mantiene siempre >= 1.
  quantity: number
  // Identidad de la incorporación y retiros acumulados; no contiene información de Orders.
  lineage?: { id: string; removed: number }
}

export interface CartPurchaseCleanup {
  baseline: readonly CartItem[]
  purchased: readonly { productId: string; quantity: number }[]
  ownerId?: string
}

// items es la única fuente de verdad del CartState; el estado de UI se mantiene separado.
// totalUnits, subtotal, IVA, shipping y total no deben almacenarse aquí como fuentes independientes.
export interface CartState {
  items: CartItem[]
}

export type CartAction =
  | { type: 'CLEAR_CART' }
  | { type: 'CLEANUP_PURCHASE'; payload: CartPurchaseCleanup }
  | { type: 'ADD_ITEM'; payload: Omit<CartItem, 'quantity'> & { initialQuantity?: number } }
  | { type: 'UPDATE_PRODUCT_CONTEXT'; payload: { productId: string; price?: number; retailPrice?: number | null; pricingType?: CartItem['pricingType']; minimumOrderQuantity?: number; branchId?: CartItem['branchId']; availableQuantity?: number | null; inventoryStatus?: CartItem['inventoryStatus']; commercialEligible?: boolean } }
  | { type: 'INCREMENT_ITEM'; payload: { productId: string } }
  | { type: 'DECREMENT_ITEM'; payload: { productId: string } }
  | { type: 'REMOVE_ITEM'; payload: { productId: string } }
  // CN-11: reemplaza los items con un carrito ya validado (p. ej. cambios desde otra pestaña).
  | { type: 'HYDRATE'; payload: { items: CartItem[] } }
