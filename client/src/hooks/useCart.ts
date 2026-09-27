import { useContext } from 'react'
import { CartContext, type CartContextValue } from '../context/CartContext'

// useCart() es el entry point recomendado para cualquier consumidor del carrito.
// CN-8: ProductCard / ProductQuickView obtendrán addItem() y convertirán Product al snapshot mínimo
// requerido por CartItem, sin quantity; no deben importar el reducer ni dispatch directamente.
// CN-9: CartPage / CartItem UI consumirán items, incrementItem(), decrementItem() y removeItem(),
// sin mutar CartState directamente. CN-13: Header / CartIndicator consumirán totalUnits.
// Estas indicaciones guían integraciones futuras; no implementan esas Stories.
export function useCart(): CartContextValue {
  const context = useContext(CartContext)
  // Detecta un consumidor fuera del Provider en lugar de devolver una API ausente silenciosamente.
  if (context === undefined) {
    throw new Error('useCart must be used within a CartProvider')
  }
  return context
}
