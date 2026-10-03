/** Encapsula el detalle modal del Product y su integración con useCart. */
import { useEffect, useRef, type MouseEvent } from 'react'

import CartFeedbackToast from './CartFeedbackToast'
import { useCart } from '../../hooks/useCart'
import type { Product } from '../../types/product'
import styles from '../../styles/catalog/ProductQuickView.module.css'

interface ProductQuickViewProps {
  product: Product
  onProductAdded: (product: Pick<Product, 'id' | 'name'>) => void
  addedProductId?: string
  onClose: () => void
  feedbackProductName?: string
}

const priceFormatter = new Intl.NumberFormat('es-CR', {
  style: 'currency',
  currency: 'CRC',
  maximumFractionDigits: 0,
})

function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="m6 6 12 12M18 6 6 18" />
    </svg>
  )
}

function CartIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3 4h2l2.2 10.1a2 2 0 0 0 2 1.6h7.9a2 2 0 0 0 1.9-1.4L21 8H7" />
      <circle cx="10" cy="20" r="1.3" />
      <circle cx="18" cy="20" r="1.3" />
    </svg>
  )
}

/** Gestiona el dialog, el foco y el bloqueo de scroll mientras muestra el detalle. */
function ProductQuickView({ product, onClose, onProductAdded, addedProductId, feedbackProductName }: ProductQuickViewProps) {
  const { addItem } = useCart()
  const dialogRef = useRef<HTMLDialogElement>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const previouslyFocusedElementRef = useRef<HTMLElement | null>(null)
  const focusRestoreFrameRef = useRef<number | null>(null)
  const titleId = `quick-view-title-${product.id}`
  const descriptionId = `quick-view-description-${product.id}`
  const availabilityLabel = product.inStock ? 'En stock' : 'Agotado'

  /** Agrega el snapshot del Product y notifica a la página para mostrar feedback temporal. */
  function handleAddToCart() {
    addItem({
      productId: product.id,
      name: product.name,
      price: product.price,
      image: product.image,
    })
    onProductAdded({ id: product.id, name: product.name })
  }

  useEffect(() => {
    const dialog = dialogRef.current

    if (!dialog) {
      return
    }

    if (focusRestoreFrameRef.current !== null) {
      window.cancelAnimationFrame(focusRestoreFrameRef.current)
    }

    if (
      previouslyFocusedElementRef.current === null &&
      document.activeElement instanceof HTMLElement
    ) {
      previouslyFocusedElementRef.current = document.activeElement
    }

    const previousBodyOverflow = document.body.style.overflow
    const previousBodyPaddingRight = document.body.style.paddingRight
    const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth
    const bodyPaddingRight = Number.parseFloat(
      window.getComputedStyle(document.body).paddingRight,
    )

    dialog.showModal()
    document.body.style.overflow = 'hidden'

    if (scrollbarWidth > 0) {
      document.body.style.paddingRight = `${bodyPaddingRight + scrollbarWidth}px`
    }

    closeButtonRef.current?.focus()

    return () => {
      if (dialog.open) {
        dialog.close()
      }

      document.body.style.overflow = previousBodyOverflow
      document.body.style.paddingRight = previousBodyPaddingRight

      const elementToRestore = previouslyFocusedElementRef.current

      focusRestoreFrameRef.current = window.requestAnimationFrame(() => {
        if (elementToRestore?.isConnected) {
          elementToRestore.focus({ preventScroll: true })
        }
      })
    }
  }, [])

  useEffect(() => {
    /** Delega el cierre del modal al owner cuando se pulsa Escape. */
    function handleEscapeKey(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
      }
    }

    document.addEventListener('keydown', handleEscapeKey)

    return () => document.removeEventListener('keydown', handleEscapeKey)
  }, [onClose])

  /** Cierra solo al pulsar el fondo del dialog, sin interceptar su contenido. */
  function handleBackdropClick(event: MouseEvent<HTMLDialogElement>) {
    if (event.target === event.currentTarget) {
      onClose()
    }
  }

  return (
    <dialog
      ref={dialogRef}
      className={styles.dialog}
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      onClick={handleBackdropClick}
      onCancel={(event) => {
        event.preventDefault()
        onClose()
      }}
    >
      {feedbackProductName ? <CartFeedbackToast productName={feedbackProductName} /> : null}
      <article className={styles.surface}>
        <button
          ref={closeButtonRef}
          className={styles.closeButton}
          type="button"
          aria-label={`Cerrar detalles de ${product.name}`}
          onClick={onClose}
        >
          <CloseIcon />
        </button>

        <div className={styles.imagePanel}>
          <div className={styles.imageGlow} aria-hidden="true" />
          <img src={product.image} alt={product.name} />
        </div>

        <div className={styles.information}>
          <p className={styles.category}>{product.category}</p>
          <h2 id={titleId}>{product.name}</h2>

          <div className={styles.commercialSummary}>
            <p className={styles.price}>{priceFormatter.format(product.price)}</p>
            <p
              className={`${styles.stock} ${
                product.inStock ? styles.inStock : styles.outOfStock
              }`}
            >
              <span aria-hidden="true" />
              {availabilityLabel}
            </p>
          </div>

          <p className={styles.description} id={descriptionId}>
            {product.description}
          </p>

          <section className={styles.specifications} aria-labelledby="specifications-title">
            <h3 id="specifications-title">Especificaciones principales</h3>
            <dl>
              {product.specifications.map((specification) => (
                <div className={styles.specificationRow} key={specification.label}>
                  <dt>{specification.label}</dt>
                  <dd>{specification.value}</dd>
                </div>
              ))}
            </dl>
          </section>

            <div className={styles.actions}>
              <button
                className={`${styles.cartButton} ${
                  addedProductId === product.id ? styles.cartButtonAdded : ''
                }`}
                type="button"
                disabled={!product.inStock}
                aria-label={
                  product.inStock
                    ? `Agregar ${product.name} al carrito`
                    : `${product.name} está agotado`
                }
                title={product.inStock ? `Agregar ${product.name} al carrito` : 'Producto agotado'}
                onClick={handleAddToCart}
              >
                <CartIcon />
                {product.inStock ? 'Agregar al carrito' : 'Agotado'}
              </button>
            </div>
        </div>
      </article>
    </dialog>
  )
}

export default ProductQuickView
