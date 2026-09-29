import { useCart } from '../../hooks/useCart'
import styles from '../../styles/catalog/CartFeedbackToast.module.css'

interface CartFeedbackToastProps {
  placement: 'catalog' | 'quick-view'
}

function CartFeedbackToast({ placement }: CartFeedbackToastProps) {
  const { cartAddFeedback } = useCart()

  if (!cartAddFeedback || cartAddFeedback.source !== placement) {
    return null
  }

  return (
    <div className={styles.toast} role="status" aria-live="polite" aria-atomic="true">
      <span className={styles.checkmark} aria-hidden="true">✓</span>
      <span>{cartAddFeedback.productName} se agregó al carrito.</span>
    </div>
  )
}

export default CartFeedbackToast
