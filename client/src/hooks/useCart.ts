/** Define el entry point de los consumidores del Cart sin exponer dispatch ni el reducer. */
import { useContext } from 'react'
import { CartContext, type CartContextValue } from '../context/CartContext'

/** Devuelve la API compartida y falla explícitamente si falta CartProvider. */
export function useCart(): CartContextValue {
  const context = useContext(CartContext)
  // Detecta un consumidor fuera del Provider en lugar de devolver una API ausente silenciosamente.
  if (context === undefined) {
    throw new Error('useCart must be used within a CartProvider')
  }
  return context
}
