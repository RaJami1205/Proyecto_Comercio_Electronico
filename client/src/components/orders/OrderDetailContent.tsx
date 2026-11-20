/**
 * Presentación compartida del snapshot autoritativo de una Order (CN-64), reutilizada por Admin Order Detail (CN-66).
 * No recalcula importes con el catálogo actual ni completa información histórica ausente.
 */
import type { Order } from '../../types/order'
import {
  branchLabel, formatOrderDate, formatOrderMoney, ORDER_STATUS_LABELS, PAYMENT_STATUS_LABELS, PAYMENT_STATUS_TONES,
} from '../../utils/orderHistoryFormat'
import styles from '../../styles/orders/OrderHistory.module.css'

export default function OrderDetailContent({ order }: { order: Order }) {
  const commercial = order.commercial
  return (
    <>
      <div className={styles.detailHeader}>
        <span className={styles.badges}>
          <span className={styles.badge} data-tone={order.orderStatus === 'CONFIRMED' ? 'success' : 'neutral'}>Pedido: {ORDER_STATUS_LABELS[order.orderStatus]}</span>
          <span className={styles.badge} data-tone={PAYMENT_STATUS_TONES[order.paymentStatus]}>{PAYMENT_STATUS_LABELS[order.paymentStatus]}</span>
        </span>
        <dl className={styles.facts}>
          <div><dt>Número de orden</dt><dd>{order.orderNumber}</dd></div>
          <div><dt>Identificador</dt><dd className={styles.code}>{order.id}</dd></div>
          <div><dt>Fecha de creación</dt><dd><time dateTime={order.createdAt}>{formatOrderDate(order.createdAt)}</time></dd></div>
        </dl>
      </div>

      <div className={styles.detailGrid}>
        <section className={styles.panel} aria-labelledby="order-commercial">
          <h2 id="order-commercial">Cliente y sucursal</h2>
          {commercial ? (
            <dl className={styles.info}>
              <dt>Tipo de cliente</dt><dd>{commercial.customerRole === 'B2B' ? 'B2B · Precios mayoristas (Wholesale)' : 'B2C · Precios al detalle (Retail)'}</dd>
              {commercial.company ? <><dt>Empresa</dt><dd>{commercial.company.name}</dd></> : null}
              <dt>Sucursal</dt><dd>{branchLabel(commercial.branchId)}</dd>
            </dl>
          ) : (
            <p className={styles.hint} role="note">
              Esta orden es anterior a las condiciones comerciales por sucursal. No registró tipo de cliente, empresa ni sucursal,
              y esa información no se completa después.
            </p>
          )}
        </section>
        <section className={styles.panel} aria-labelledby="order-buyer">
          <h2 id="order-buyer">Comprador</h2>
          <dl className={styles.info}>
            <dt>Nombre</dt><dd>{order.buyer.fullName}</dd>
            <dt>Correo</dt><dd>{order.buyer.email}</dd>
            <dt>Teléfono</dt><dd>{order.buyer.phone}</dd>
          </dl>
        </section>
        <section className={styles.panel} aria-labelledby="order-delivery">
          <h2 id="order-delivery">Entrega</h2>
          <dl className={styles.info}>
            <dt>Provincia</dt><dd>{order.delivery.province}</dd>
            <dt>Cantón</dt><dd>{order.delivery.canton}</dd>
            <dt>Dirección</dt><dd>{order.delivery.address}</dd>
            {order.delivery.additionalInfo ? <><dt>Indicaciones</dt><dd>{order.delivery.additionalInfo}</dd></> : null}
          </dl>
        </section>
      </div>

      <section className={styles.panel} aria-labelledby="order-items">
        <h2 id="order-items">Productos</h2>
        <table className={styles.items}>
          <thead><tr><th scope="col">Producto</th><th scope="col">Cantidad</th><th scope="col">Precio unitario</th><th scope="col">Subtotal</th></tr></thead>
          <tbody>
            {order.items.map(item => (
              <tr key={item.productId}>
                <td data-label="Producto">
                  {item.name}
                  {commercial?.customerRole === 'B2B' && item.minOrderQuantity ? <small className={styles.moq}>Mínimo de compra (MOQ): {item.minOrderQuantity} unidades</small> : null}
                </td>
                <td data-label="Cantidad">{item.quantity}</td>
                <td data-label="Precio unitario">{formatOrderMoney(item.unitPrice)}</td>
                <td data-label="Subtotal">{formatOrderMoney(item.lineSubtotal)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <div className={styles.detailGrid}>
        <section className={styles.panel} aria-labelledby="order-totals">
          <h2 id="order-totals">Importes</h2>
          <dl className={styles.totals}>
            <dt>Subtotal</dt><dd>{formatOrderMoney(order.totals.subtotal)}</dd>
            <dt>IVA (13%)</dt><dd>{formatOrderMoney(order.totals.tax)}</dd>
            <dt>Envío</dt><dd>{formatOrderMoney(order.totals.shipping)}</dd>
            <dt className={styles.grandTotal}>Total</dt><dd className={styles.grandTotal}>{formatOrderMoney(order.totals.total)}</dd>
          </dl>
          <p className={styles.hint}>Importes registrados al crear la orden. No cambian aunque cambien los precios del catálogo.</p>
        </section>
        <section className={styles.panel} aria-labelledby="order-terms">
          <h2 id="order-terms">Términos y condiciones</h2>
          <dl className={styles.info}>
            <dt>Versión aceptada</dt><dd>{order.termsAcceptance.version}</dd>
            <dt>Aceptados el</dt><dd><time dateTime={order.termsAcceptance.acceptedAt}>{formatOrderDate(order.termsAcceptance.acceptedAt)}</time></dd>
          </dl>
        </section>
      </div>
    </>
  )
}
