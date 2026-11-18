/** Presenta datos e importes de Review; CheckoutPage controla consentimiento, bloqueos y confirmación. */
import type { Ref } from 'react'
import type { BuyerInfo, DeliveryInfo } from '../../types/checkout'
import type { Order, OrderItem, OrderTotals } from '../../types/order'
import styles from '../../styles/checkout/ReviewStep.module.css'
import pageStyles from '../../styles/pages/CheckoutPage.module.css'

/** Identidad y contexto comercial presentados en Review; tras crear la Order provienen de su snapshot. */
export interface ReviewCommercialSummary {
  displayName: string
  customerRole: 'B2C' | 'B2B'
  companyName?: string
  branchName?: string
  confirmedByServer: boolean
}

interface ReviewStepProps {
  buyer: BuyerInfo
  delivery: DeliveryInfo
  items: readonly OrderItem[]
  totals: OrderTotals
  order?: Order
  busy?: boolean
  retryPending?: boolean
  invalid?: boolean
  authorizationRejected?: boolean
  error?: string
  differences?: readonly string[]
  commercial?: ReviewCommercialSummary
  onAdjustCart?: () => void
  termsAccepted: boolean
  termsError?: string
  termsVersionRejected?: boolean
  termsInputRef?: Ref<HTMLInputElement>
  onTermsAcceptedChange: (accepted: boolean) => void
  onOpenTerms: () => void
  onAbandon?: () => void
  onEdit?: (step: 'buyer' | 'delivery') => void
  onConfirm?: () => void
}

/** Presenta comprador, entrega, productos y totales recibidos; expone las acciones permitidas por los callbacks y bloqueos. */
function ReviewStep({ buyer, delivery, items, totals, order, busy = false, retryPending = false, invalid = false, authorizationRejected = false, error, differences = [], commercial, onAdjustCart, termsAccepted, termsError, termsVersionRejected, termsInputRef, onTermsAcceptedChange, onOpenTerms, onAbandon, onEdit, onConfirm }: ReviewStepProps) {
  const confirmed = order?.orderStatus === 'CONFIRMED' && order.paymentStatus === 'APPROVED'
  /** Formatea el importe recibido para presentación sin modificar el valor financiero original. */
  const money = (value: number) => new Intl.NumberFormat('es-CR', { style: 'currency', currency: order?.currency ?? 'CRC' }).format(value)
  return (
    <div className={styles.layout}>
      <div className={styles.details}>
        {commercial ? <section className={styles.card} aria-labelledby="review-account">
          <h3 id="review-account">Cuenta y sucursal</h3>
          <dl className={styles.info}>
            <dt>Identidad</dt><dd>{commercial.displayName}</dd>
            <dt>Tipo de cliente</dt><dd>{commercial.customerRole === 'B2B' ? 'B2B · Precios mayoristas (Wholesale)' : 'B2C · Precios al detalle (Retail)'}</dd>
            {commercial.customerRole === 'B2B' && commercial.companyName ? <><dt>Empresa</dt><dd>{commercial.companyName}</dd></> : null}
            <dt>Sucursal</dt><dd>{commercial.branchName ?? 'Sin sucursal seleccionada'}</dd>
          </dl>
          <p className={styles.note}>{commercial.confirmedByServer
            ? 'Condiciones comerciales confirmadas por el servidor al crear la orden.'
            : 'Todos los productos se validan contra el inventario de esta única sucursal.'}</p>
        </section> : null}
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
              <div><h4>{item.name}</h4><p>Cantidad: {item.quantity}</p>{commercial?.customerRole === 'B2B' && item.minOrderQuantity ? <p>Mínimo de compra (MOQ): {item.minOrderQuantity} unidades</p> : null}<p>Precio unitario: {money(item.unitPrice)}</p><strong>Subtotal: {money(item.lineSubtotal)}</strong></div>
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
        {!order ? <p className={styles.note}>Los precios, cantidades, impuestos y envío se validan nuevamente en el servidor antes de crear la orden.</p> : null}
        <dl className={styles.totals}><dt>Subtotal</dt><dd>{money(totals.subtotal)}</dd><dt>IVA (13%)</dt><dd>{money(totals.tax)}</dd><dt>Costo de envío</dt><dd>{totals.shipping === 0 ? 'Gratis' : money(totals.shipping)}</dd><dt className={styles.total}>Total</dt><dd className={styles.total}>{money(totals.total)}</dd></dl>
        {order ? <div className={styles.orderInfo}><p>Orden: <strong>{order.orderNumber}</strong></p><p>Estado de la orden: {order.orderStatus === 'PENDING' ? 'Pendiente' : order.orderStatus}</p><p>Estado del pago: {order.paymentStatus === 'PENDING' ? 'Pendiente' : order.paymentStatus}</p></div> : null}
        {invalid ? <p role="alert" className={styles.error}>Completa los datos del comprador y la entrega y verifica que tu carrito tenga productos con cantidades válidas.</p> : null}
        {error ? <p role="alert" className={styles.error}>{error}</p> : null}
        {onAdjustCart ? <div className={pageStyles.actions}><button type="button" className={pageStyles.back} onClick={onAdjustCart}>Ajustar en el carrito</button></div> : null}
        {retryPending && !busy ? <p role="status">No se ha podido confirmar el resultado. La orden podría haberse creado. Reintentar envía la misma solicitud con la misma identidad para evitar duplicarla, conservando tus datos y productos. No puedes salir ni cambiar de identidad hasta resolver el intento.</p> : null}
        {!order ? <div className={styles.terms}>
          <label className={styles.termsLabel} htmlFor="checkout-terms">
            <input id="checkout-terms" ref={termsInputRef} type="checkbox" checked={termsAccepted}
              disabled={busy || retryPending} onChange={event => onTermsAcceptedChange(event.target.checked)}
              aria-invalid={termsError ? true : undefined}
              aria-describedby={termsError ? 'checkout-terms-error checkout-terms-version' : 'checkout-terms-version'} />
            <span>He leído y acepto los Términos y Condiciones de CiberNova.</span>
          </label>
          <button type="button" className={styles.termsLink} onClick={onOpenTerms} disabled={busy}>
            <span className={styles.termsLinkText}>Consultar Términos y Condiciones</span>
          </button>
          <p id="checkout-terms-version">{termsVersionRejected ? 'Versión local rechazada por el servidor' : ''}</p>
          {termsError ? <p id="checkout-terms-error" role="alert" className={styles.error}>{termsError}</p> : null}
        </div> : null}
        {onConfirm ? <div className={pageStyles.actions}><button type="button" className={pageStyles.continue} disabled={busy || invalid || authorizationRejected} onClick={onConfirm}>{busy ? 'Creando orden…' : differences.length > 0 ? 'Aceptar cambios y continuar al pago' : order ? 'Continuar al pago' : retryPending ? 'Reintentar la misma solicitud' : 'Confirmar y continuar al pago'}</button></div> : null}
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
