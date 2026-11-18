/**
 * My Orders (CN-64): historial paginado del comprador activo, consultado al Server en cada montaje.
 * App lo monta con una key por usuario y epoch de Session, así un cambio de identidad descarta resultados y requests previos.
 */
import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react'
import { AccessNotice, OrdersShell } from '../components/orders/OrdersShell'
import { useSession } from '../hooks/useSession'
import { orderHistoryApi, OrderHistoryApiError, type OrderHistoryErrorKind } from '../services/orderHistoryApi'
import type { OrderSummary } from '../types/order'
import { hashForOrder, isSameTabNavigation, type CatalogHash, type PolicyView } from '../utils/appNavigation'
import {
  branchLabel, formatOrderDate, formatOrderMoney, ORDER_STATUS_LABELS, PAYMENT_STATUS_LABELS, PAYMENT_STATUS_TONES,
} from '../utils/orderHistoryFormat'
import styles from '../styles/orders/OrderHistory.module.css'

const ORDER_HISTORY_PAGE_SIZE = 10

interface MyOrdersPageProps {
  onOpenOrder: (orderId: string) => void
  onCatalogClick: (hash?: CatalogHash) => void
  onPolicyNavigate: (view: PolicyView) => void
  onCartClick: () => void
}

type ListState =
  | { status: 'loading' }
  | { status: 'error'; kind: OrderHistoryErrorKind }
  | { status: 'ready'; orders: OrderSummary[]; page: number; total: number; hasMore: boolean; loadingMore: boolean; moreError: boolean }

const errorKind = (error: unknown): OrderHistoryErrorKind => error instanceof OrderHistoryApiError ? error.kind : 'unavailable'

function OrderCard({ order, onOpenOrder }: { order: OrderSummary; onOpenOrder: (orderId: string) => void }) {
  function open(event: MouseEvent<HTMLAnchorElement>) {
    if (!isSameTabNavigation(event)) return
    event.preventDefault()
    onOpenOrder(order.id)
  }
  return (
    <li className={styles.card}>
      <div className={styles.cardHeader}>
        <h2 className={styles.orderNumber}>{order.orderNumber}</h2>
        <span className={styles.badges}>
          <span className={styles.badge} data-tone={order.orderStatus === 'CONFIRMED' ? 'success' : 'neutral'}>{ORDER_STATUS_LABELS[order.orderStatus]}</span>
          <span className={styles.badge} data-tone={PAYMENT_STATUS_TONES[order.paymentStatus]}>{PAYMENT_STATUS_LABELS[order.paymentStatus]}</span>
        </span>
      </div>
      <dl className={styles.facts}>
        <div><dt>Fecha</dt><dd><time dateTime={order.createdAt}>{formatOrderDate(order.createdAt)}</time></dd></div>
        <div><dt>Sucursal</dt><dd>{branchLabel(order.branchId)}</dd></div>
        <div><dt>Total</dt><dd className={styles.total}>{formatOrderMoney(order.total)}</dd></div>
      </dl>
      {order.contractVersion === 1 ? <p className={styles.hint}>Orden anterior a las condiciones comerciales por sucursal.</p> : null}
      <a className={styles.detailLink} href={hashForOrder(order.id)} onClick={open}
        aria-label={`Ver detalle de la orden ${order.orderNumber}`}>Ver detalle</a>
    </li>
  )
}

/** Consulta y presenta las páginas del usuario recibido; nunca reutiliza resultados de otra identidad. */
function OrderHistoryList({ userId, onOpenOrder }: { userId: string; onOpenOrder: (orderId: string) => void }) {
  const [state, setState] = useState<ListState>({ status: 'loading' })
  const [reload, setReload] = useState(0)
  const moreController = useRef<AbortController | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    orderHistoryApi.listMine(userId, 1, ORDER_HISTORY_PAGE_SIZE, controller.signal).then(
      page => { if (!controller.signal.aborted) setState({ status: 'ready', orders: page.orders, page: page.page, total: page.total, hasMore: page.hasMore, loadingMore: false, moreError: false }) },
      error => { if (!controller.signal.aborted) setState({ status: 'error', kind: errorKind(error) }) },
    )
    return () => { controller.abort(); moreController.current?.abort() }
  }, [userId, reload])

  function retry() {
    setState({ status: 'loading' })
    setReload(value => value + 1)
  }

  function loadMore() {
    if (state.status !== 'ready' || state.loadingMore || !state.hasMore) return
    const controller = new AbortController()
    moreController.current = controller
    const nextPage = state.page + 1
    setState({ ...state, loadingMore: true, moreError: false })
    orderHistoryApi.listMine(userId, nextPage, ORDER_HISTORY_PAGE_SIZE, controller.signal).then(
      page => {
        if (controller.signal.aborted) return
        setState(current => {
          if (current.status !== 'ready') return current
          // Una Order nueva puede desplazar el offset; se omiten IDs ya presentados.
          const known = new Set(current.orders.map(order => order.id))
          return { status: 'ready', orders: [...current.orders, ...page.orders.filter(order => !known.has(order.id))],
            page: page.page, total: page.total, hasMore: page.hasMore, loadingMore: false, moreError: false }
        })
      },
      () => {
        if (controller.signal.aborted) return
        setState(current => current.status === 'ready' ? { ...current, loadingMore: false, moreError: true } : current)
      },
    )
  }

  if (state.status === 'loading') return <p className={styles.status} role="status" aria-busy="true">Cargando tus órdenes…</p>
  if (state.status === 'error') {
    if (state.kind === 'session' || state.kind === 'forbidden') return <AccessNotice kind={state.kind} />
    return (
      <div className={styles.error} role="alert">
        <p>No pudimos cargar tus órdenes en este momento. Tus compras no se modificaron.</p>
        <button type="button" className={styles.secondaryButton} onClick={retry}>Reintentar</button>
      </div>
    )
  }
  if (state.orders.length === 0) {
    return (
      <div className={styles.notice} role="status">
        <h2>Todavía no tienes órdenes</h2>
        <p>Cuando completes una compra, aparecerá aquí con su estado de pedido y de pago.</p>
      </div>
    )
  }
  return (
    <section aria-label="Historial de órdenes">
      <p className={styles.summary}>Mostrando {state.orders.length} de {state.total} {state.total === 1 ? 'orden' : 'órdenes'}, de la más reciente a la más antigua.</p>
      <ul className={styles.list}>
        {state.orders.map(order => <OrderCard key={order.id} order={order} onOpenOrder={onOpenOrder} />)}
      </ul>
      {state.moreError ? <p className={styles.error} role="alert">No pudimos cargar más órdenes. Intenta de nuevo.</p> : null}
      {state.hasMore ? (
        <div className={styles.actions}>
          <button type="button" className={styles.secondaryButton} onClick={loadMore} disabled={state.loadingMore} aria-busy={state.loadingMore}>
            {state.loadingMore ? 'Cargando más órdenes…' : 'Cargar más órdenes'}
          </button>
        </div>
      ) : null}
    </section>
  )
}

export default function MyOrdersPage({ onOpenOrder, ...shell }: MyOrdersPageProps) {
  const { user } = useSession()
  let content: ReactNode
  if (!user) content = <AccessNotice kind="session" />
  else if (user.role === 'ADMIN') content = <AccessNotice kind="forbidden" />
  else content = <OrderHistoryList key={user.id} userId={user.id} onOpenOrder={onOpenOrder} />
  return (
    <OrdersShell {...shell} eyebrow="Mi cuenta" title="Mis órdenes"
      introduction="Consulta tus compras, su sucursal, los importes registrados y el estado de cada pedido y pago.">
      {content}
    </OrdersShell>
  )
}
