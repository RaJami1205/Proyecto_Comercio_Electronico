/**
 * Order Detail (CN-64): presenta el snapshot autoritativo devuelto por el Server.
 * No recalcula importes con el catálogo actual ni completa información histórica ausente.
 */
import { useEffect, useState, type ReactNode } from 'react'
import { AccessNotice, OrdersShell } from '../components/orders/OrdersShell'
import { useSession } from '../hooks/useSession'
import { orderHistoryApi, OrderHistoryApiError, type OrderHistoryErrorKind } from '../services/orderHistoryApi'
import type { Order } from '../types/order'
import type { CatalogHash, PolicyView } from '../utils/appNavigation'
import {
  branchLabel, formatOrderDate, formatOrderMoney, ORDER_STATUS_LABELS, PAYMENT_STATUS_LABELS, PAYMENT_STATUS_TONES,
} from '../utils/orderHistoryFormat'
import styles from '../styles/orders/OrderHistory.module.css'

interface OrderDetailPageProps {
  orderId: string
  onBackToOrders: () => void
  onCatalogClick: (hash?: CatalogHash) => void
  onPolicyNavigate: (view: PolicyView) => void
  onCartClick: () => void
}

type DetailState = { status: 'loading' } | { status: 'error'; kind: OrderHistoryErrorKind } | { status: 'ready'; order: Order }

function BackButton({ onBack }: { onBack: () => void }) {
  return <button type="button" className={styles.secondaryButton} onClick={onBack}>Volver a mis órdenes</button>
}

function OrderDetailContent({ order }: { order: Order }) {
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

/** Consulta una sola vez por montaje; App remonta el detalle al cambiar de usuario, epoch u Order ID. */
function OrderDetailLoader({ userId, orderId, onBackToOrders }: { userId: string; orderId: string; onBackToOrders: () => void }) {
  const [state, setState] = useState<DetailState>({ status: 'loading' })
  const [reload, setReload] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    orderHistoryApi.getOrder(userId, orderId, controller.signal).then(
      order => { if (!controller.signal.aborted) setState({ status: 'ready', order }) },
      error => { if (!controller.signal.aborted) setState({ status: 'error', kind: error instanceof OrderHistoryApiError ? error.kind : 'unavailable' }) },
    )
    return () => controller.abort()
  }, [userId, orderId, reload])

  let content: ReactNode
  if (state.status === 'loading') content = <p className={styles.status} role="status" aria-busy="true">Cargando el detalle de la orden…</p>
  else if (state.status === 'ready') content = <OrderDetailContent order={state.order} />
  else if (state.kind === 'session' || state.kind === 'forbidden') content = <AccessNotice kind={state.kind} />
  else if (state.kind === 'not-found') {
    content = (
      <div className={styles.notice} role="alert">
        <h2>No encontramos esta orden</h2>
        <p>La orden no existe o no pertenece a tu cuenta.</p>
      </div>
    )
  } else {
    content = (
      <div className={styles.error} role="alert">
        <p>No pudimos cargar el detalle de la orden en este momento.</p>
        <button type="button" className={styles.secondaryButton} onClick={() => { setState({ status: 'loading' }); setReload(value => value + 1) }}>Reintentar</button>
      </div>
    )
  }
  return (
    <>
      <div className={styles.actions}><BackButton onBack={onBackToOrders} /></div>
      {content}
    </>
  )
}

export default function OrderDetailPage({ orderId, onBackToOrders, ...shell }: OrderDetailPageProps) {
  const { user } = useSession()
  let content: ReactNode
  if (!user) content = <AccessNotice kind="session" />
  else if (user.role === 'ADMIN') content = <AccessNotice kind="forbidden" />
  else content = <OrderDetailLoader key={user.id + ':' + orderId} userId={user.id} orderId={orderId} onBackToOrders={onBackToOrders} />
  return <OrdersShell {...shell} eyebrow="Mis órdenes" title="Detalle de la orden">{content}</OrdersShell>
}
