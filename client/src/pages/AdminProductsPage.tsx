/**
 * Admin Products (CN-67): consulta Read-Only del catálogo con precios Retail/Wholesale, MOQ e inventario por sucursal.
 * Los filtros y la paginación se resuelven en el Server; App monta la página con una key por usuario y epoch de Session.
 */
import { useEffect, useState, type FormEvent, type MouseEvent, type ReactNode } from 'react'
import { AdminAccessNotice, AdminShell, Badge, type AdminShellProps } from '../components/admin/AdminShell'
import BranchInventoryTable from '../components/admin/BranchInventoryTable'
import { useSession } from '../hooks/useSession'
import { adminProductApi, AdminProductApiError, type AdminProductErrorKind } from '../services/adminProductApi'
import type { AdminAvailabilityFilter, AdminB2BStatus, AdminProduct, AdminProductFilters, AdminProductPage, AdminProductSort } from '../types/adminProduct'
import { BRANCH_IDS, type BranchId } from '../types/branch'
import {
  AVAILABILITY_LABELS, AVAILABILITY_TONES, B2B_STATUS_LABELS, B2B_STATUS_TONES, formatAdminMoney, formatUnits,
} from '../utils/adminProductFormat'
import { INITIAL_ADMIN_FILTERS, withFilter } from '../utils/adminProductFilters'
import { hashForAdminProduct, isSameTabNavigation } from '../utils/appNavigation'
import { BRANCH_LABELS } from '../utils/orderHistoryFormat'
import styles from '../styles/admin/AdminProducts.module.css'

const PRODUCT_AVAILABILITY: readonly AdminAvailabilityFilter[] = ['available', 'limited', 'out-of-stock', 'below-moq', 'invalid']
const BRANCH_AVAILABILITY: readonly AdminAvailabilityFilter[] = ['available', 'below-moq', 'out-of-stock', 'invalid']
const AVAILABILITY_FILTER_LABELS: Readonly<Record<AdminAvailabilityFilter, string>> = {
  available: 'Disponible', limited: 'Stock limitado (agotado en alguna sucursal)', 'out-of-stock': 'Agotado',
  'below-moq': 'Insuficiente para el MOQ B2B', invalid: 'Inventario no disponible',
}
const SORT_LABELS: Readonly<Record<AdminProductSort, string>> = {
  relevance: 'Relevancia', title: 'Nombre (A-Z)', retail_asc: 'Precio Retail: menor a mayor', retail_desc: 'Precio Retail: mayor a menor',
  stock_asc: 'Existencias: menor a mayor', stock_desc: 'Existencias: mayor a menor',
}

type ListState =
  | { status: 'loading' }
  | { status: 'error'; kind: AdminProductErrorKind }
  | { status: 'ready'; result: AdminProductPage }

const errorKind = (error: unknown): AdminProductErrorKind => error instanceof AdminProductApiError ? error.kind : 'unavailable'

function ProductCard({ product, branchId, onOpenProduct }: { product: AdminProduct; branchId: BranchId | ''; onOpenProduct: (id: string) => void }) {
  function open(event: MouseEvent<HTMLAnchorElement>) {
    if (!isSameTabNavigation(event)) return
    event.preventDefault()
    onOpenProduct(product.id)
  }
  const { pricing, inventory } = product
  return (
    <li className={styles.card}>
      <div className={styles.cardHeader}>
        {product.image ? <img className={styles.thumbnail} src={product.image} alt="" loading="lazy" width={72} height={72} /> : null}
        <div className={styles.identity}>
          <h2 className={styles.productTitle}>{product.title}</h2>
          <p className={styles.hint}>{[product.sku ? 'SKU ' + product.sku : 'Sin SKU', product.brand].filter(Boolean).join(' · ')}</p>
        </div>
      </div>
      <span className={styles.badges}>
        <Badge tone={AVAILABILITY_TONES[inventory.availability]}>{AVAILABILITY_LABELS[inventory.availability]}</Badge>
        <Badge tone={B2B_STATUS_TONES[pricing.b2bStatus]}>{B2B_STATUS_LABELS[pricing.b2bStatus]}</Badge>
        {inventory.insufficientForMoq ? <Badge tone="warning">Ninguna sucursal alcanza el MOQ</Badge> : null}
        {product.issues.length ? <Badge tone="danger">{product.issues.length === 1 ? '1 inconsistencia' : `${product.issues.length} inconsistencias`}</Badge> : null}
      </span>
      <dl className={styles.facts}>
        <div><dt>Retail (B2C)</dt><dd>{formatAdminMoney(pricing.retailPrice)}</dd></div>
        <div><dt>Wholesale (B2B)</dt><dd>{formatAdminMoney(pricing.wholesalePrice)}</dd></div>
        <div><dt>MOQ B2B</dt><dd>{pricing.minOrderQuantity === null ? 'No definido' : formatUnits(pricing.minOrderQuantity)}</dd></div>
        <div><dt>Stock global</dt><dd>{formatUnits(inventory.globalStock)}</dd></div>
      </dl>
      <BranchInventoryTable branches={inventory.branches} highlight={branchId || undefined} caption={`Existencias por sucursal de ${product.title}`} />
      <a className={styles.detailLink} href={hashForAdminProduct(product.id)} onClick={open}
        aria-label={`Ver detalle administrativo de ${product.title}`}>Ver detalle</a>
    </li>
  )
}

/** Opciones de facets del resultado actual; conserva la seleccionada aunque ya no aparezca. */
function facetOptions(facets: Record<string, number>, selected: string): string[] {
  const values = Object.keys(facets)
  if (selected && !values.includes(selected)) values.push(selected)
  return values.sort((first, second) => first.localeCompare(second, 'es'))
}

/** Consulta las páginas del usuario recibido; un cambio de filtros aborta la solicitud anterior. */
function AdminProductCatalog({ userId, onOpenProduct }: { userId: string; onOpenProduct: (id: string) => void }) {
  const [filters, setFilters] = useState<AdminProductFilters>(INITIAL_ADMIN_FILTERS)
  const [draft, setDraft] = useState('')
  const [state, setState] = useState<ListState>({ status: 'loading' })
  const [facets, setFacets] = useState<AdminProductPage['facets']>({ categories: {}, brands: {} })
  const [reload, setReload] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    adminProductApi.list(userId, filters, controller.signal).then(
      result => {
        if (controller.signal.aborted) return
        setState({ status: 'ready', result })
        setFacets(result.facets)
      },
      error => { if (!controller.signal.aborted) setState({ status: 'error', kind: errorKind(error) }) },
    )
    return () => controller.abort()
  }, [userId, filters, reload])

  function update(patch: Partial<AdminProductFilters>) {
    setState({ status: 'loading' })
    setFilters(current => withFilter(current, patch))
  }
  function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    update({ q: draft })
  }
  function reset() {
    setDraft('')
    setState({ status: 'loading' })
    // Un objeto nuevo fuerza la consulta aunque los filtros ya estuvieran en su estado inicial.
    setFilters({ ...INITIAL_ADMIN_FILTERS })
  }
  function retry() {
    setState({ status: 'loading' })
    setReload(value => value + 1)
  }

  let results: ReactNode
  if (state.status === 'loading') results = <p className={styles.status} role="status" aria-busy="true">Cargando productos…</p>
  else if (state.status === 'error') {
    results = state.kind === 'session' || state.kind === 'forbidden' ? <AdminAccessNotice kind={state.kind} /> : (
      <div className={styles.error} role="alert">
        <p>{state.kind === 'invalid-filter' ? 'Los filtros seleccionados no son válidos. Ajusta la búsqueda o limpia los filtros.'
          : 'No pudimos consultar el catálogo en este momento. Ningún producto ni inventario fue modificado.'}</p>
        <button type="button" className={styles.secondaryButton} onClick={state.kind === 'invalid-filter' ? reset : retry}>
          {state.kind === 'invalid-filter' ? 'Limpiar filtros' : 'Reintentar'}
        </button>
      </div>
    )
  } else if (state.result.products.length === 0) {
    results = (
      <div className={styles.notice} role="status">
        <h2>Sin resultados</h2>
        <p>Ningún producto coincide con la búsqueda y los filtros seleccionados.</p>
      </div>
    )
  } else {
    const { result } = state
    results = (
      <section aria-label="Resultados del catálogo administrativo">
        <p className={styles.summary} role="status">
          {result.total} {result.total === 1 ? 'producto' : 'productos'} · página {result.page} de {result.totalPages}
          {filters.branchId ? ` · estado evaluado en ${BRANCH_LABELS[filters.branchId]}` : ''}
        </p>
        <ul className={styles.list}>
          {result.products.map(product => <ProductCard key={product.id} product={product} branchId={filters.branchId} onOpenProduct={onOpenProduct} />)}
        </ul>
        <nav className={styles.pagination} aria-label="Paginación de productos">
          <button type="button" className={styles.secondaryButton} disabled={result.page <= 1} onClick={() => update({ page: result.page - 1 })}>Anterior</button>
          <span>Página {result.page} de {result.totalPages}</span>
          <button type="button" className={styles.secondaryButton} disabled={result.page >= result.totalPages} onClick={() => update({ page: result.page + 1 })}>Siguiente</button>
        </nav>
      </section>
    )
  }

  const availabilityOptions = filters.branchId ? BRANCH_AVAILABILITY : PRODUCT_AVAILABILITY
  return (
    <>
      <form className={styles.filters} role="search" aria-label="Buscar y filtrar productos" onSubmit={search}>
        <label className={styles.searchField}>
          <span>Buscar por nombre, marca o SKU</span>
          <span className={styles.searchRow}>
            <input type="search" value={draft} maxLength={120} onChange={event => setDraft(event.target.value)} placeholder="Ej. SSD, Logitech o SAM-DIS-0214" />
            <button type="submit" className={styles.primaryButton}>Buscar</button>
          </span>
        </label>
        <label><span>Categoría</span>
          <select value={filters.category} onChange={event => update({ category: event.target.value })}>
            <option value="">Todas</option>
            {facetOptions(facets.categories, filters.category).map(value => <option key={value} value={value}>{value}</option>)}
          </select>
        </label>
        <label><span>Marca</span>
          <select value={filters.brand} onChange={event => update({ brand: event.target.value })}>
            <option value="">Todas</option>
            {facetOptions(facets.brands, filters.brand).map(value => <option key={value} value={value}>{value}</option>)}
          </select>
        </label>
        <label><span>Sucursal</span>
          <select value={filters.branchId} onChange={event => update({ branchId: event.target.value as BranchId | '' })}>
            <option value="">Todas (disponibilidad global)</option>
            {BRANCH_IDS.map(id => <option key={id} value={id}>{BRANCH_LABELS[id]}</option>)}
          </select>
        </label>
        <label><span>Disponibilidad</span>
          <select value={filters.availability} onChange={event => update({ availability: event.target.value as AdminAvailabilityFilter | '' })}>
            <option value="">Todas</option>
            {availabilityOptions.map(value => <option key={value} value={value}>{AVAILABILITY_FILTER_LABELS[value]}</option>)}
          </select>
        </label>
        <label><span>Condición B2B</span>
          <select value={filters.b2b} onChange={event => update({ b2b: event.target.value as AdminB2BStatus | '' })}>
            <option value="">Todas</option>
            {(['eligible', 'not-available', 'invalid'] as const).map(value => <option key={value} value={value}>{B2B_STATUS_LABELS[value]}</option>)}
          </select>
        </label>
        <label><span>Ordenar por</span>
          <select value={filters.sort} onChange={event => update({ sort: event.target.value as AdminProductSort })}>
            {(Object.keys(SORT_LABELS) as AdminProductSort[]).map(value => <option key={value} value={value}>{SORT_LABELS[value]}</option>)}
          </select>
        </label>
        <button type="button" className={styles.secondaryButton} onClick={reset}>Limpiar filtros</button>
      </form>
      {results}
    </>
  )
}

export default function AdminProductsPage({ onOpenProduct, ...shell }: AdminShellProps & { onOpenProduct: (productId: string) => void }) {
  const { user } = useSession()
  let content: ReactNode
  if (!user) content = <AdminAccessNotice kind="session" />
  else if (user.role !== 'ADMIN') content = <AdminAccessNotice kind="forbidden" />
  else content = <AdminProductCatalog key={user.id} userId={user.id} onOpenProduct={onOpenProduct} />
  return (
    <AdminShell {...shell} title="Productos e inventario"
      introduction="Consulta precios Retail y Wholesale, condiciones B2B y existencias de San José, Alajuela, Cartago y Heredia. Esta vista no modifica productos, precios ni inventario.">
      {content}
    </AdminShell>
  )
}
