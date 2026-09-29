import type { MouseEvent } from 'react'

import { useCart } from '../../hooks/useCart'
import styles from '../../styles/cart/CartSection.module.css'

interface CartSectionProps {
  onContinueShopping: () => void
  onProductSelect: (productId: string) => void
}

const priceFormatter = new Intl.NumberFormat('es-CR', {
  style: 'currency',
  currency: 'CRC',
  maximumFractionDigits: 0,
})

function CartSection({ onContinueShopping, onProductSelect }: CartSectionProps) {
  const { items, incrementItem, decrementItem, removeItem, totalUnits } = useCart()
  const subtotal = items.reduce((sum, item) => sum + item.price * item.quantity, 0)

  function handleContinueShopping(event: MouseEvent<HTMLAnchorElement>) {
    event.preventDefault()
    onContinueShopping()
  }

  return (
    <section className={styles.section} id="cart" aria-labelledby="cart-title">
      <div className={styles.container}>
        <header className={styles.introduction}>
          <div>
            <p className={styles.eyebrow}>Tu selección</p>
            <h2 id="cart-title">Tu carrito</h2>
          </div>
          <p className={styles.description}>
            Revisa tus productos y ajusta las cantidades antes de continuar.
          </p>
        </header>

        {items.length === 0 ? (
          <div className={styles.emptyState}>
            <div className={styles.emptyIcon} aria-hidden="true">
              <svg viewBox="0 0 48 48">
                <path d="M7 9h5l5.1 22.2a4 4 0 0 0 3.9 3.1h17.4a4 4 0 0 0 3.8-2.8L46 17H15" />
                <circle cx="21" cy="41" r="2.5" />
                <circle cx="37" cy="41" r="2.5" />
              </svg>
            </div>
            <h3>Tu carrito está vacío</h3>
            <p>Explora el catálogo y agrega los productos que te interesan.</p>
            <a href="#catalog" onClick={handleContinueShopping}>
              Ir al catálogo
            </a>
          </div>
        ) : (
          <div className={styles.cartLayout}>
            <div className={styles.itemList} role="list" aria-label="Productos en el carrito">
              {items.map((item) => {
                const itemSubtotal = item.price * item.quantity

                return (
                  <article className={styles.item} key={item.productId} role="listitem">
                    <div className={styles.imagePanel}>
                      <button
                        className={styles.productImageButton}
                        type="button"
                        aria-label={`Ver detalles de ${item.name}`}
                        aria-haspopup="dialog"
                        onClick={() => onProductSelect(item.productId)}
                      >
                        <img src={item.image} alt="" loading="lazy" />
                      </button>
                    </div>

                    <div className={styles.itemDetails}>
                      <div className={styles.itemHeading}>
                        <div>
                          <h3>
                            <button
                              className={styles.productNameButton}
                              type="button"
                              aria-haspopup="dialog"
                              onClick={() => onProductSelect(item.productId)}
                            >
                              {item.name}
                            </button>
                          </h3>
                          <p className={styles.unitPrice}>
                            Precio unitario: {priceFormatter.format(item.price)}
                          </p>
                        </div>
                        <button
                          className={styles.removeButton}
                          type="button"
                          aria-label={`Eliminar ${item.name} del carrito`}
                          onClick={() => removeItem(item.productId)}
                        >
                          <svg viewBox="0 0 20 20" aria-hidden="true">
                            <path d="M3 5h14M8 5V3h4v2m3 0-.8 11H5.8L5 5m3 3v5m4-5v5" />
                          </svg>
                          <span>Eliminar</span>
                        </button>
                      </div>

                      <div className={styles.itemFooter}>
                        <div
                          className={styles.quantityControl}
                          role="group"
                          aria-label={`Cantidad de ${item.name}`}
                        >
                          <button
                            type="button"
                            aria-label={`Disminuir cantidad de ${item.name}`}
                            disabled={item.quantity <= 1}
                            onClick={() => decrementItem(item.productId)}
                          >
                            <span aria-hidden="true">−</span>
                          </button>
                          <span className={styles.quantity} aria-live="polite">{item.quantity}</span>
                          <button
                            type="button"
                            aria-label={`Aumentar cantidad de ${item.name}`}
                            onClick={() => incrementItem(item.productId)}
                          >
                            <span aria-hidden="true">+</span>
                          </button>
                        </div>
                        <p className={styles.itemSubtotal}>
                          <span>Subtotal</span>
                          <strong>{priceFormatter.format(itemSubtotal)}</strong>
                        </p>
                      </div>
                    </div>
                  </article>
                )
              })}
            </div>

            <aside className={styles.summary} aria-labelledby="summary-title">
              <h3 id="summary-title">Resumen del carrito</h3>
              <p className={styles.summaryUnits}>
                {totalUnits} {totalUnits === 1 ? 'producto' : 'productos'}
              </p>
              <div className={styles.summaryTotal}>
                <span>Total</span>
                <strong>{priceFormatter.format(subtotal)}</strong>
              </div>
              <a href="#catalog" onClick={handleContinueShopping}>
                Seguir comprando
              </a>
            </aside>
          </div>
        )}
      </div>
    </section>
  )
}

export default CartSection
