/**
 * Admin Orders (CN-66): consulta global Read-Only de Orders de compradores B2C/B2B.
 * Sin texto de búsqueda el Server lista desde PostgreSQL (incluye Orders sin indexar); con texto busca en el índice
 * orders de Algolia y muestra el estado actual persistido. App la monta con una key por usuario y epoch de Session.
 */
import { useEffect, useState, type FormEvent, type MouseEvent, type ReactNode } from 'react'
import { AdminAccessNotice, AdminShell, Badge, type AdminShellProps } from '../components/admin/AdminShell'
import { useSession } from '../hooks/useSession'
import { adminOrderApi, AdminOrderApiError, type AdminOrderErrorKind } from '../services/adminOrderApi'
import type { AdminOrderFilters, AdminOrderPage, AdminOrderSummary } from '../types/adminOrder'
import { BRANCH_IDS, type BranchId } from '../types/branch'
import type { OrderStatus, PaymentStatus } from '../types/order'
import { hashForAdminOrder, isSameTabNavigation } from '../utils/appNavigation'
import {
  BRANCH_LABELS, branchLabel, formatOrderDate, formatOrderMoney, ORDER_STATUS_LABELS, PAYMENT_STATUS_LABELS, PAYMENT_STATUS_TONES,
} from '../utils/orderHistoryFormat'
import styles from '../styles/admin/AdminProducts.module.css'

const INITIAL_FILTERS: AdminOrderFilters = {
  q: '', orderNumber: '', userId: '', customerRole: '', branchId: '', orderStatus: '', paymentStatus: '', sort: 'newest', page: 1,
}

type ListState =
  | { status: 'loading' }
  | { status: 'error'; kind: AdminOrderErrorKind }
  | { status: 'ready'; result: AdminOrderPage }

const errorKind = (error: unknown): AdminOrderErrorKind => error instanceof AdminOrderApiError ? error.kind : 'unavailable'

function OrderRow({ order, onOpenOrder }: { order: AdminOrderSummary; onOpenOrder?: (orderId: string) => void }) {
  function open(event: MouseEvent<HTMLAnchorElement>) {
    if (!onOpenOrder || !isSameTabNavigation(event)) return
    event.preventDefault()
    onOpenOrder(order.id)
  }
  return (
    <li className={styles.card}>
      <div className={styles.identity}>
        <h2 className={styles.productTitle}>{order.orderNumber}</h2>
        <p className={styles.hint}><time dateTime={order.createdAt}>{formatOrderDate(order.createdAt)}</time></p>
      </div>
      <span className={styles.badges}>
        <Badge tone={order.orderStatus === 'CONFIRMED' ? 'success' : 'neutral'}>Pedido: {ORDER_STATUS_LABELS[order.orderStatus]}</Badge>
        <Badge tone={PAYMENT_STATUS_TONES[order.paymentStatus]}>{PAYMENT_STATUS_LABELS[order.paymentStatus]}</Badge>
        {order.customerRole ? <Badge tone="neutral">{order.customerRole}</Badge> : null}
        {order.indexOutdated ? <Badge tone="warning">Índice desactualizado · estado actual</Badge> : null}
      </span>
      <dl className={styles.facts}>
        <div><dt>Comprador</dt><dd>{order.displayName ?? 'No registrado'}{order.userId ? <span className={styles.hint}> · {order.userId}</span> : null}</dd></div>
        <div><dt>Empresa</dt><dd>{order.company?.name ?? (order.customerRole === 'B2B' ? 'No registrada' : 'No aplica')}</dd></div>
        <div><dt>Sucursal</dt><dd>{branchLabel(order.branchId)}</dd></div>
        <div><dt>Total</dt><dd>{formatOrderMoney(order.total)} {order.currency}</dd></div>
      </dl>
      {order.contractVersion === 1 ? <p className={styles.hint}>Orden anterior a las condiciones comerciales por sucursal.</p> : null}
      {onOpenOrder ? <a className={styles.detailLink} href={hashForAdminOrder(order.id)} onClick={open}
        aria-label={`Ver detalle de la orden ${order.orderNumber}`}>Ver detalle</a> : null}
    </li>
  )
}

/** Consulta las páginas del usuario recibido; un cambio de filtros aborta la solicitud anterior. */
function AdminOrdersList({ userId, onOpenOrder }: { userId: string; onOpenOrder?: (orderId: string) => void }) {
  const [filters, setFilters] = useState<AdminOrderFilters>(INITIAL_FILTERS)
  const [draft, setDraft] = useState({ q: '', orderNumber: '', userId: '' })
  const [state, setState] = useState<ListState>({ status: 'loading' })
  const [reload, setReload] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    adminOrderApi.list(userId, filters, controller.signal).then(
      result => { if (!controller.signal.aborted) setState({ status: 'ready', result }) },
      error => { if (!controller.signal.aborted) setState({ status: 'error', kind: errorKind(error) }) },
    )
    return () => controller.abort()
  }, [userId, filters, reload])

  /** Todo cambio vuelve a la página 1 salvo la paginación; un objeto nuevo fuerza la consulta. */
  function update(patch: Partial<AdminOrderFilters>) {
    setState({ status: 'loading' })
    setFilters(current => ({ ...current, ...patch, page: patch.page ?? 1 }))
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    // La búsqueda en el índice y el número exacto en PostgreSQL son excluyentes.
    const q = draft.q.trim()
    update({ q, orderNumber: q ? '' : draft.orderNumber.trim(), userId: draft.userId.trim() })
    if (q) setDraft(current => ({ ...current, orderNumber: '' }))
  }
  function reset() {
    setDraft({ q: '', orderNumber: '', userId: '' })
    update({ ...INITIAL_FILTERS })
  }
  function retry() {
    setState({ status: 'loading' })
    setReload(value => value + 1)
  }
  function clearSearch() {
    setDraft(current => ({ ...current, q: '' }))
    update({ q: '' })
  }

  const searching = filters.q !== ''
  let results: ReactNode
  if (state.status === 'loading') results = <p className={styles.status} role="status" aria-busy="true">Cargando órdenes…</p>
  else if (state.status === 'error') {
    if (state.kind === 'session' || state.kind === 'forbidden') results = <AdminAccessNotice kind={state.kind} subject="orders" />
    else if (state.kind === 'search-unavailable') {
      results = (
        <div className={styles.error} role="alert">
          <p>La búsqueda en el índice de órdenes no está disponible. El listado con filtros consulta directamente las órdenes persistidas.</p>
          <button type="button" className={styles.secondaryButton} onClick={clearSearch}>Ver listado sin búsqueda</button>
        </div>
      )
    } else {
      results = (
        <div className={styles.error} role="alert">
          <p>{state.kind === 'invalid-filter' ? 'Los filtros seleccionados no son válidos. Revisa los valores o limpia los filtros.'
            : 'No pudimos consultar las órdenes en este momento. Ninguna orden ni pago fue modificado.'}</p>
          <button type="button" className={styles.secondaryButton} onClick={state.kind === 'invalid-filter' ? reset : retry}>
            {state.kind === 'invalid-filter' ? 'Limpiar filtros' : 'Reintentar'}
          </button>
        </div>
      )
    }
  } else {
    const { result } = state
    const pending = result.pendingIndexOrders ?? 0
    const pages = Math.max(1, Math.ceil(result.total / result.pageSize))
    results = (
      <section aria-label="Resultados de órdenes">
        {result.source === 'algolia' ? (
          <p className={styles.notice} role="note">
            Resultados del índice de búsqueda. El estado mostrado es el actual de PostgreSQL.
            {pending > 0 ? ` Hay ${pending} ${pending === 1 ? 'orden pendiente' : 'órdenes pendientes'} de indexar que esta búsqueda puede omitir; el listado sin búsqueda sí las incluye.` : ''}
            {result.missingFromStore ? ` Se omitieron ${result.missingFromStore} coincidencias del índice que ya no existen.` : ''}
          </p>
        ) : pending > 0 ? (
          <p className={styles.hint} role="note">{pending} {pending === 1 ? 'orden aún no está indexada' : 'órdenes aún no están indexadas'} para búsqueda; este listado sí las incluye.</p>
        ) : null}
        {result.orders.length === 0 ? (
          <div className={styles.notice} role="status">
            <h2>Sin órdenes</h2>
            <p>{searching ? 'Ninguna orden del índice coincide con la búsqueda.' : 'No hay órdenes que coincidan con los filtros seleccionados.'}</p>
          </div>
        ) : (
          <>
            <p className={styles.summary} role="status">{result.total} {result.total === 1 ? 'orden' : 'órdenes'} · página {result.page} de {pages}</p>
            <ul className={styles.list}>{result.orders.map(order => <OrderRow key={order.id} order={order} onOpenOrder={onOpenOrder} />)}</ul>
            <nav className={styles.pagination} aria-label="Paginación de órdenes">
              <button type="button" className={styles.secondaryButton} disabled={result.page <= 1} onClick={() => update({ page: result.page - 1 })}>Anterior</button>
              <span>Página {result.page} de {pages}</span>
              <button type="button" className={styles.secondaryButton} disabled={!result.hasMore} onClick={() => update({ page: result.page + 1 })}>Siguiente</button>
            </nav>
          </>
        )}
      </section>
    )
  }

  return (
    <>
      <form className={styles.filters} role="search" aria-label="Buscar y filtrar órdenes" onSubmit={submit}>
        <label className={styles.searchField}>
          <span>Buscar por número de orden o empresa (índice de búsqueda)</span>
          <input type="search" value={draft.q} maxLength={80} onChange={event => setDraft({ ...draft, q: event.target.value })} placeholder="Ej. CN-2026 o Distribuidora" />
        </label>
        <label><span>Número de orden exacto</span>
          <input type="text" value={draft.orderNumber} maxLength={80} disabled={draft.q.trim() !== ''}
            onChange={event => setDraft({ ...draft, orderNumber: event.target.value })} placeholder="CN-2026-…" />
        </label>
        <label><span>User ID</span>
          <input type="text" value={draft.userId} maxLength={64} onChange={event => setDraft({ ...draft, userId: event.target.value })} placeholder="user-b2b-01" />
        </label>
        <button type="submit" className={styles.primaryButton}>Aplicar búsqueda</button>
        <label><span>Tipo de comprador</span>
          <select value={filters.customerRole} onChange={event => update({ customerRole: event.target.value as AdminOrderFilters['customerRole'] })}>
            <option value="">Todos</option><option value="B2C">B2C</option><option value="B2B">B2B</option>
          </select>
        </label>
        <label><span>Sucursal</span>
          <select value={filters.branchId} onChange={event => update({ branchId: event.target.value as BranchId | '' })}>
            <option value="">Todas</option>
            {BRANCH_IDS.map(id => <option key={id} value={id}>{BRANCH_LABELS[id]}</option>)}
          </select>
        </label>
        <label><span>Estado del pedido</span>
          <select value={filters.orderStatus} onChange={event => update({ orderStatus: event.target.value as OrderStatus | '' })}>
            <option value="">Todos</option>
            {(Object.keys(ORDER_STATUS_LABELS) as OrderStatus[]).map(value => <option key={value} value={value}>{ORDER_STATUS_LABELS[value]}</option>)}
          </select>
        </label>
        <label><span>Estado del pago</span>
          <select value={filters.paymentStatus} onChange={event => update({ paymentStatus: event.target.value as PaymentStatus | '' })}>
            <option value="">Todos</option>
            {(Object.keys(PAYMENT_STATUS_LABELS) as PaymentStatus[]).map(value => <option key={value} value={value}>{PAYMENT_STATUS_LABELS[value]}</option>)}
          </select>
        </label>
        <label><span>Orden</span>
          <select value={filters.sort} disabled={searching} onChange={event => update({ sort: event.target.value as AdminOrderFilters['sort'] })}>
            <option value="newest">Más recientes primero</option><option value="oldest">Más antiguas primero</option>
          </select>
        </label>
        <button type="button" className={styles.secondaryButton} onClick={reset}>Limpiar filtros</button>
      </form>
      {results}
    </>
  )
}

export default function AdminOrdersPage({ onOpenOrder, ...shell }: AdminShellProps & { onOpenOrder?: (orderId: string) => void }) {
  const { user } = useSession()
  let content: ReactNode
  if (!user) content = <AdminAccessNotice kind="session" subject="orders" />
  else if (user.role !== 'ADMIN') content = <AdminAccessNotice kind="forbidden" subject="orders" />
  else content = <AdminOrdersList key={user.id} userId={user.id} onOpenOrder={onOpenOrder} />
  return (
    <AdminShell {...shell} section="orders" title="Órdenes"
      introduction="Consulta las órdenes de todos los compradores B2C y B2B con su sucursal, importes y estados. Esta vista no crea, paga ni modifica órdenes.">
      {content}
    </AdminShell>
  )
}
