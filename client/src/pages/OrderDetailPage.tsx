/**
 * Order Detail (CN-64): presenta el snapshot autoritativo devuelto por el Server.
 * No recalcula importes con el catálogo actual ni completa información histórica ausente.
 */
import { useEffect, useState, type ReactNode } from 'react'
import { AccessNotice, OrdersShell } from '../components/orders/OrdersShell'
import OrderDetailContent from '../components/orders/OrderDetailContent'
import { useSession } from '../hooks/useSession'
import { orderHistoryApi, OrderHistoryApiError, type OrderHistoryErrorKind } from '../services/orderHistoryApi'
import type { Order } from '../types/order'
import type { CatalogHash, PolicyView } from '../utils/appNavigation'
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
