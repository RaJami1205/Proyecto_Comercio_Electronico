/** Preview de presentación: el Cart y sus cálculos siguen siendo compartidos. */
import { useEffect, useRef } from 'react'
import { useCart } from '../../hooks/useCart'
import { calculateCartTotals } from '../../utils/cartCalculations'
import styles from '../../styles/cart/CartPreviewDrawer.module.css'

interface CartPreviewDrawerProps {
  onClose: () => void
  onViewCart: () => void
  onContinueShopping: () => void
  onCheckoutRequested?: () => void
  shouldRestoreFocus?: () => boolean
}

const priceFormatter = new Intl.NumberFormat('es-CR', {
  style: 'currency',
  currency: 'CRC',
  maximumFractionDigits: 0,
})

function CartPreviewDrawer({
  onClose, onViewCart, onContinueShopping, onCheckoutRequested, shouldRestoreFocus,
}: CartPreviewDrawerProps) {
  const { items } = useCart()
  const { subtotal } = calculateCartTotals(items)
  const dialogRef = useRef<HTMLDialogElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const triggerRef = useRef<HTMLElement | null>(null)
  const restoreFrameRef = useRef<number | null>(null)
  const overlayPointerRef = useRef(false)

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (restoreFrameRef.current !== null) cancelAnimationFrame(restoreFrameRef.current)
    if (triggerRef.current === null && document.activeElement instanceof HTMLElement) {
      triggerRef.current = document.activeElement
    }

    const previousOverflow = document.body.style.overflow
    const previousPadding = document.body.style.paddingRight
    const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth
    const padding = Number.parseFloat(getComputedStyle(document.body).paddingRight) || 0
    dialog.showModal()
    document.body.style.overflow = 'hidden'
    if (scrollbarWidth > 0) document.body.style.paddingRight = `${padding + scrollbarWidth}px`
    closeRef.current?.focus()

    return () => {
      dialog.close()
      document.body.style.overflow = previousOverflow
      document.body.style.paddingRight = previousPadding
      if (shouldRestoreFocus && !shouldRestoreFocus()) return
      // Espera al commit de navegación: el trigger anterior puede quedar hidden/inert.
      restoreFrameRef.current = requestAnimationFrame(() => {
        const isAvailable = (element: HTMLElement | null): element is HTMLElement =>
          element !== null && element.isConnected &&
          !element.closest('[hidden], [inert]') && element.getClientRects().length > 0
        const previous = triggerRef.current
        if (isAvailable(previous)) {
          previous.focus({ preventScroll: true })
        } else {
          const destination = Array.from(
            document.querySelectorAll<HTMLButtonElement>('[data-cart-preview-trigger]'),
          ).find(isAvailable)
          destination?.focus({ preventScroll: true })
        }
      })
    }
  }, [shouldRestoreFocus])

  return (
    <dialog
      ref={dialogRef}
      className={styles.dialog}
      aria-labelledby="cart-preview-title"
      onCancel={(event) => { event.preventDefault(); onClose() }}
      onPointerDown={(event) => {
        overlayPointerRef.current = event.target === event.currentTarget
      }}
      onClick={(event) => {
        if (overlayPointerRef.current && event.target === event.currentTarget) onClose()
        overlayPointerRef.current = false
      }}
    >
      <section className={styles.panel}>
        <header className={styles.header}>
          <h2 id="cart-preview-title">Tu carrito</h2>
          <button ref={closeRef} type="button" className={styles.close} onClick={onClose} aria-label="Cerrar vista previa del carrito">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>
          </button>
        </header>

        <div className={styles.content}>
          {items.length === 0 ? (
            <div className={styles.empty}>
              <h3>Tu carrito está vacío</h3>
              <p>Explora el catálogo y agrega los productos que te interesan.</p>
              <button type="button" className={styles.primary} onClick={onContinueShopping}>Ir al catálogo</button>
            </div>
          ) : (
            <ul className={styles.list} aria-label="Productos en el carrito">
              {items.map((item) => (
                <li key={item.productId} className={styles.item}>
                  <img src={item.image} alt="" loading="lazy" />
                  <div>
                    <h3>{item.name}</h3>
                    <p>Cantidad: {item.quantity}</p>
                    <p>Precio unitario: <strong>{priceFormatter.format(item.price)}</strong></p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <footer className={styles.footer}>
          {items.length > 0 ? (
            <>
              <p className={styles.subtotal}><span>Subtotal</span><strong>{priceFormatter.format(subtotal)}</strong></p>
              <button type="button" className={styles.primary} onClick={onViewCart}>Ver carrito</button>
            </>
          ) : null}
          <button
            type="button"
            className={styles.checkout}
            disabled={!onCheckoutRequested || items.length === 0}
            aria-describedby={!onCheckoutRequested ? 'cart-preview-checkout-note' : undefined}
            onClick={onCheckoutRequested}
          >Finalizar compra</button>
          {!onCheckoutRequested ? (
            <p id="cart-preview-checkout-note" className={styles.note}>Disponible próximamente con el flujo de Checkout.</p>
          ) : null}
        </footer>
      </section>
    </dialog>
  )
}

export default CartPreviewDrawer
