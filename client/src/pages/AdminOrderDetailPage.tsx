/**
 * Admin Order Detail (CN-66): identidad del comprador desde la API administrativa y snapshot autoritativo de
 * GET /api/v2/orders/:orderId (Store seleccionado). Reutiliza la presentación del detalle del comprador; solo consulta.
 */
import { useEffect, useState, type ReactNode } from 'react'
import { AdminAccessNotice, AdminShell, type AdminShellProps } from '../components/admin/AdminShell'
import OrderDetailContent from '../components/orders/OrderDetailContent'
import { useSession } from '../hooks/useSession'
import { adminOrderApi, AdminOrderApiError } from '../services/adminOrderApi'
import { orderHistoryApi, OrderHistoryApiError } from '../services/orderHistoryApi'
import type { AdminOrderSummary } from '../types/adminOrder'
import type { Order } from '../types/order'
import { branchLabel } from '../utils/orderHistoryFormat'
import styles from '../styles/admin/AdminProducts.module.css'

type DetailErrorKind = 'session' | 'forbidden' | 'not-found' | 'unavailable'
type DetailState = { status: 'loading' } | { status: 'error'; kind: DetailErrorKind } | { status: 'ready'; order: Order; summary: AdminOrderSummary }

/** Unifica los errores de ambos servicios en las categorías que presenta la vista. */
function detailErrorKind(error: unknown): DetailErrorKind {
  if (error instanceof OrderHistoryApiError) return error.kind
  if (error instanceof AdminOrderApiError) return error.kind === 'session' || error.kind === 'forbidden' ? error.kind : 'unavailable'
  return 'unavailable'
}

function BuyerIdentity({ summary }: { summary: AdminOrderSummary }) {
  return (
    <section className={styles.panel} aria-labelledby="admin-order-identity">
      <h2 id="admin-order-identity">Identidad del comprador</h2>
      <dl className={styles.info}>
        <div><dt>User ID</dt><dd className={styles.code}>{summary.userId ?? 'No registrado'}</dd></div>
        <div><dt>Nombre visible</dt><dd>{summary.displayName ?? 'No registrado'}</dd></div>
        <div><dt>Tipo de cliente</dt><dd>{summary.customerRole ?? 'No registrado'}</dd></div>
        <div><dt>Empresa</dt><dd>{summary.company ? `${summary.company.name} (${summary.company.id})` : 'No aplica'}</dd></div>
        <div><dt>Sucursal</dt><dd>{branchLabel(summary.branchId)}</dd></div>
      </dl>
      <p className={styles.hint}>Datos históricos registrados al crear la orden. Esta vista es de solo consulta: no permite pagar ni cambiar estados.</p>
    </section>
  )
}

/** Consulta una vez por montaje; App remonta el detalle al cambiar de usuario, epoch u Order ID. */
function AdminOrderLoader({ userId, orderId, onBack }: { userId: string; orderId: string; onBack: () => void }) {
  const [state, setState] = useState<DetailState>({ status: 'loading' })
  const [reload, setReload] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    adminOrderApi.getSummary(userId, orderId, controller.signal)
      .then(async summary => {
        if (!summary) return { status: 'error', kind: 'not-found' } as const
        // El contexto comercial del snapshot debe pertenecer al comprador que informa el listado administrativo.
        const order = await orderHistoryApi.getOrder(userId, orderId, controller.signal, summary.userId)
        return { status: 'ready', order, summary } as const
      })
      .then(
        next => { if (!controller.signal.aborted) setState(next) },
        error => { if (!controller.signal.aborted) setState({ status: 'error', kind: detailErrorKind(error) }) },
      )
    return () => controller.abort()
  }, [userId, orderId, reload])

  let content: ReactNode
  if (state.status === 'loading') content = <p className={styles.status} role="status" aria-busy="true">Cargando el detalle de la orden…</p>
  else if (state.status === 'ready') content = <><BuyerIdentity summary={state.summary} /><OrderDetailContent order={state.order} /></>
  else if (state.kind === 'session' || state.kind === 'forbidden') content = <AdminAccessNotice kind={state.kind} subject="orders" />
  else if (state.kind === 'not-found') {
    content = (
      <div className={styles.notice} role="status">
        <h2>Orden no encontrada</h2>
        <p>La orden solicitada no existe en la persistencia.</p>
      </div>
    )
  } else {
    content = (
      <div className={styles.error} role="alert">
        <p>No pudimos consultar el detalle de la orden en este momento. La orden no fue modificada.</p>
        <button type="button" className={styles.secondaryButton} onClick={() => { setState({ status: 'loading' }); setReload(value => value + 1) }}>Reintentar</button>
      </div>
    )
  }
  return (
    <>
      <div className={styles.actions}>
        <button type="button" className={styles.secondaryButton} onClick={onBack}>Volver a órdenes</button>
      </div>
      {content}
    </>
  )
}

export default function AdminOrderDetailPage({ orderId, onBack, ...shell }: AdminShellProps & { orderId: string; onBack: () => void }) {
  const { user } = useSession()
  let content: ReactNode
  if (!user) content = <AdminAccessNotice kind="session" subject="orders" />
  else if (user.role !== 'ADMIN') content = <AdminAccessNotice kind="forbidden" subject="orders" />
  else content = <AdminOrderLoader key={user.id + ':' + orderId} userId={user.id} orderId={orderId} onBack={onBack} />
  return <AdminShell {...shell} section="orders" title="Detalle de la orden">{content}</AdminShell>
}
