import { useEffect, useState } from 'react'
import type { Order } from '../types/order'
import { createPaidOrderCartCleanup } from '../utils/paidOrderCartCleanup'
import { useCart } from './useCart'

/** Consume únicamente el snapshot de la Order recibido desde el servidor. */
export function useClearCartAfterPayment(order: Order | undefined): void {
  const { clearCart } = useCart()
  const [cleanup] = useState(() => createPaidOrderCartCleanup(clearCart))

  useEffect(() => {
    cleanup(order)
  }, [cleanup, order])
}
