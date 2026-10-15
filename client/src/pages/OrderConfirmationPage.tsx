import { useEffect, useRef } from 'react'
import type { Order } from '../types/order'
import Header from '../components/layout/Header'
import Footer from '../components/layout/Footer'
import styles from '../styles/pages/OrderConfirmationPage.module.css'

interface OrderConfirmationPageProps {
  order: Order
  onCatalogClick: (hash?: '#top' | '#catalog') => void
  onCartClick: () => void
}

/**
 * Vista dedicada de confirmación (CN-33). Es un snapshot puro de la Order
 * autoritativa: no lee CartState ni recalcula nada a partir de él, y no
 * ofrece ninguna acción de pago (no hay Retry posible desde acá).
 */
function OrderConfirmationPage({ order, onCatalogClick, onCartClick }: OrderConfirmationPageProps) {
  // Defensa adicional: aunque quien monta esta página ya debe garantizar
  // Order CONFIRMED/APPROVED, nunca se presenta una confirmación falsa
  // si por algún estado inconsistente se llegara a invocar sin cumplirlo.
  const isConfirmed = order.orderStatus === 'CONFIRMED' && order.paymentStatus === 'APPROVED'
  const headingRef = useRef<HTMLHeadingElement>(null)

  useEffect(() => {
    if (isConfirmed) headingRef.current?.focus()
  }, [isConfirmed])

  const money = (value: number) =>
    new Intl.NumberFormat('es-CR', { style: 'currency', currency: order.currency }).format(value)

  const formattedDate = new Intl.DateTimeFormat('es-CR', {
    dateStyle: 'long',
    timeStyle: 'short',
  }).format(new Date(order.createdAt))

  if (!isConfirmed) {
    return (
      <div className={styles.page}>
        <Header onCartClick={onCartClick} onCatalogClick={onCatalogClick} />
        <main className={styles.main}>
          <div className={styles.container}>
            <div className={styles.safeState} role="alert">
              <h1>No pudimos mostrar la confirmación</h1>
              <p>No encontramos una orden con pago aprobado para confirmar. Si ya completaste tu compra, revisa tu correo o contacta soporte.</p>
              <button type="button" className={styles.catalogButton} onClick={() => onCatalogClick()}>
                Volver al catálogo
              </button>
            </div>
          </div>
        </main>
        <Footer onCatalogClick={onCatalogClick} />
      </div>
    )
  }

  return (
    <div className={styles.page}>
      <Header onCartClick={onCartClick} onCatalogClick={onCatalogClick} />
      <main className={styles.main}>
        <div className={styles.container}>
          <div className={styles.banner} role="status">
            <span className={styles.bannerIcon} aria-hidden="true">✓</span>
            <div className={styles.bannerText}>
              <h1 ref={headingRef} tabIndex={-1}>Compra confirmada</h1>
              <p className={styles.orderNumber}>
                Orden <strong>{order.orderNumber}</strong>
              </p>
              <p className={styles.date}>{formattedDate}</p>
            </div>
          </div>

          <section className={styles.section} aria-labelledby="confirmation-buyer-heading">
            <h2 id="confirmation-buyer-heading">Información del comprador</h2>
            <dl className={styles.detailList}>
              <div>
                <dt>Nombre</dt>
                <dd>{order.buyer.fullName}</dd>
              </div>
              <div>
                <dt>Correo</dt>
                <dd>{order.buyer.email}</dd>
              </div>
              <div>
                <dt>Teléfono</dt>
                <dd>{order.buyer.phone}</dd>
              </div>
            </dl>
          </section>

          <section className={styles.section} aria-labelledby="confirmation-delivery-heading">
            <h2 id="confirmation-delivery-heading">Información de entrega</h2>
            <dl className={styles.detailList}>
              <div>
                <dt>Provincia</dt>
                <dd>{order.delivery.province}</dd>
              </div>
              <div>
                <dt>Cantón</dt>
                <dd>{order.delivery.canton}</dd>
              </div>
              <div>
                <dt>Dirección</dt>
                <dd>{order.delivery.address}</dd>
              </div>
              {order.delivery.additionalInfo ? (
                <div>
                  <dt>Información adicional</dt>
                  <dd>{order.delivery.additionalInfo}</dd>
                </div>
              ) : null}
            </dl>
          </section>

          <section className={styles.section} aria-labelledby="confirmation-items-heading">
            <h2 id="confirmation-items-heading">Productos</h2>
            <ul className={styles.items}>
              {order.items.map((item) => (
                <li key={item.productId} className={styles.item}>
                  <img src={item.image} alt="" className={styles.itemImage} />
                  <div className={styles.itemInfo}>
                    <p className={styles.itemName}>{item.name}</p>
                    <p className={styles.itemMeta}>
                      {item.quantity} × {money(item.unitPrice)}
                    </p>
                  </div>
                  <p className={styles.itemSubtotal}>{money(item.lineSubtotal)}</p>
                </li>
              ))}
            </ul>
          </section>

          <section className={styles.section} aria-labelledby="confirmation-totals-heading">
            <h2 id="confirmation-totals-heading">Resumen financiero</h2>
            <dl className={styles.totals}>
              <div>
                <dt>Subtotal</dt>
                <dd>{money(order.totals.subtotal)}</dd>
              </div>
              <div>
                <dt>IVA</dt>
                <dd>{money(order.totals.tax)}</dd>
              </div>
              <div>
                <dt>Envío</dt>
                <dd>{money(order.totals.shipping)}</dd>
              </div>
              <div className={styles.totalRow}>
                <dt>Total</dt>
                <dd>{money(order.totals.total)}</dd>
              </div>
            </dl>
          </section>

          <div className={styles.actions}>
            <button type="button" className={styles.catalogButton} onClick={() => onCatalogClick()}>
              Volver al catálogo
            </button>
          </div>
        </div>
      </main>
      <Footer onCatalogClick={onCatalogClick} />
    </div>
  )
}

export default OrderConfirmationPage
