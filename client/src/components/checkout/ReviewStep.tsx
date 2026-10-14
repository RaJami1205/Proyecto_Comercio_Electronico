import type { BuyerInfo, DeliveryInfo } from '../../types/checkout'
import type { Order, OrderItem, OrderTotals } from '../../types/order'
import styles from '../../styles/checkout/ReviewStep.module.css'
import pageStyles from '../../styles/pages/CheckoutPage.module.css'

interface ReviewStepProps {
  buyer: BuyerInfo
  delivery: DeliveryInfo
  items: readonly OrderItem[]
  totals: OrderTotals
  order?: Order
  busy?: boolean
  retryPending?: boolean
  invalid?: boolean
  error?: string
  differences?: readonly string[]
  onAbandon?: () => void
  onEdit?: (step: 'buyer' | 'delivery') => void
  onConfirm?: () => void
}

function ReviewStep({ buyer, delivery, items, totals, order, busy = false, retryPending = false, invalid = false, error, differences = [], onAbandon, onEdit, onConfirm }: ReviewStepProps) {
  const confirmed = order?.orderStatus === 'CONFIRMED' && order.paymentStatus === 'APPROVED'
  const money = (value: number) => new Intl.NumberFormat('es-CR', { style: 'currency', currency: order?.currency ?? 'CRC' }).format(value)
  return (
    <div className={styles.layout}>
      <div className={styles.details}>
        <section className={styles.card} aria-labelledby="review-buyer">
          <div className={styles.sectionHeading}><h3 id="review-buyer">Comprador</h3>
            {onEdit ? <button type="button" disabled={busy || retryPending} onClick={() => onEdit('buyer')}>Editar comprador</button> : null}
          </div>
          <dl className={styles.info}><dt>Nombre completo</dt><dd>{buyer.fullName}</dd><dt>Correo electrónico</dt><dd>{buyer.email}</dd><dt>Teléfono</dt><dd>{buyer.phone}</dd></dl>
        </section>
        <section className={styles.card} aria-labelledby="review-delivery">
          <div className={styles.sectionHeading}><h3 id="review-delivery">Entrega</h3>
            {onEdit ? <button type="button" disabled={busy || retryPending} onClick={() => onEdit('delivery')}>Editar entrega</button> : null}
          </div>
          <dl className={styles.info}><dt>Provincia</dt><dd>{delivery.province}</dd><dt>Cantón</dt><dd>{delivery.canton}</dd><dt>Dirección</dt><dd>{delivery.address}</dd>
            {delivery.additionalInfo ? <><dt>Información adicional</dt><dd>{delivery.additionalInfo}</dd></> : null}
          </dl>
        </section>
        <section className={styles.card} aria-labelledby="review-products">
          <h3 id="review-products">Productos</h3>
          <ul className={styles.products}>{items.map(item => (
            <li key={item.productId} className={styles.product}>
              {item.image ? <img src={item.image} alt={item.name} width="72" height="72" /> : <span className={styles.noImage}>Sin imagen</span>}
              <div><h4>{item.name}</h4><p>Cantidad: {item.quantity}</p><p>Precio unitario: {money(item.unitPrice)}</p><strong>Subtotal: {money(item.lineSubtotal)}</strong></div>
            </li>
          ))}</ul>
          {!items.length ? <p>Tu carrito está vacío.</p> : null}
        </section>
      </div>
      <aside className={styles.summary} aria-labelledby="review-summary">
        <h3 id="review-summary">Resumen de compra</h3>
        {confirmed ? <p role="status">Esta orden ya está confirmada y su pago fue aprobado. No se solicitará otro pago. Tu carrito se conserva.</p> : null}
        {order?.paymentStatus === 'DECLINED' ? <p role="status">La orden sigue pendiente. Su último intento de pago fue rechazado.</p> : null}
        {order?.paymentStatus === 'ERROR' ? <p role="status">La orden sigue pendiente. Su último intento de pago terminó con un error.</p> : null}
        {differences.length > 0 ? <div role="alert" className={styles.orderInfo}>
          <p><strong>Las condiciones de tu compra cambiaron.</strong> Revisa los importes actualizados de la orden antes de aceptarlos y continuar al pago.</p>
          <ul>{differences.map((difference, index) => <li key={index}>{difference}</li>)}</ul>
        </div> : null}
        <p>{order ? 'Estos son los montos de tu orden.' : 'Revisa tu compra. Los montos finales se confirmarán al crear la orden.'}</p>
        <dl className={styles.totals}><dt>Subtotal</dt><dd>{money(totals.subtotal)}</dd><dt>IVA (13%)</dt><dd>{money(totals.tax)}</dd><dt>Costo de envío</dt><dd>{totals.shipping === 0 ? 'Gratis' : money(totals.shipping)}</dd><dt className={styles.total}>Total</dt><dd className={styles.total}>{money(totals.total)}</dd></dl>
        {order ? <div className={styles.orderInfo}><p>Orden: <strong>{order.orderNumber}</strong></p><p>Estado de la orden: {order.orderStatus === 'PENDING' ? 'Pendiente' : order.orderStatus}</p><p>Estado del pago: {order.paymentStatus === 'PENDING' ? 'Pendiente' : order.paymentStatus}</p></div> : null}
        {invalid ? <p role="alert" className={styles.error}>Completa los datos del comprador y la entrega y verifica que tu carrito tenga productos con cantidades válidas.</p> : null}
        {error ? <p role="alert" className={styles.error}>{error}</p> : null}
        {retryPending && !busy ? <p role="status">No se ha podido confirmar el resultado. La orden podría haberse creado. Reintentar envía la misma solicitud con la misma identidad para evitar duplicarla, conservando tus datos y productos.</p> : null}
        {onConfirm ? <div className={pageStyles.actions}><button type="button" className={pageStyles.continue} disabled={busy || invalid} onClick={onConfirm}>{busy ? 'Creando orden…' : differences.length > 0 ? 'Aceptar cambios y continuar al pago' : order ? 'Continuar al pago' : retryPending ? 'Reintentar la misma solicitud' : 'Confirmar y continuar al pago'}</button></div> : null}
        {onAbandon && !busy ? <div className={styles.orderInfo}>
          <p id="checkout-exit-warning">{confirmed
            ? 'Al salir conservas los productos del carrito. Los datos temporales del Checkout se perderán; la orden confirmada no cambia ni se realiza otro pago.'
            : order
            ? 'Al salir conservas los productos del carrito, pero se perderán los datos temporales del Checkout. La orden no se cancela. Si un pago quedó sin resolver, salir no lo cancela ni confirma su resultado. Iniciar otro Checkout puede crear una nueva orden.'
            : 'Al salir conservas los productos del carrito, pero se perderán los datos del comprador, entrega y la identidad de este intento. La orden podría haberse creado; salir no la cancela. Iniciar otro Checkout podría crear una orden duplicada.'}</p>
          <div className={pageStyles.actions}><button type="button" className={pageStyles.back} aria-describedby="checkout-exit-warning" onClick={onAbandon}>Salir del Checkout</button></div>
        </div> : null}
        <p role="status" aria-live="polite">{busy ? 'Estamos confirmando tu orden. Espera un momento.' : ''}</p>
      </aside>
    </div>
  )
}

export default ReviewStep
