/** Presenta el feedback temporal recibido desde la capa de página, sin poseer estado del Cart. */
import styles from '../../styles/catalog/CartFeedbackToast.module.css'

interface CartFeedbackToastProps {
  productName: string
}

/** Anuncia el producto agregado mediante una región de estado accesible. */
function CartFeedbackToast({ productName }: CartFeedbackToastProps) {
  return (
    <div className={styles.toast} role="status" aria-live="polite" aria-atomic="true">
      <span className={styles.checkmark} aria-hidden="true">✓</span>
      <span>{productName} se agregó al carrito.</span>
    </div>
  )
}

export default CartFeedbackToast
