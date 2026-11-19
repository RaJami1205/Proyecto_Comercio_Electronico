/** Admin Product Detail (CN-67): ficha Read-Only con precios, condiciones B2B, inventario global y por sucursal. */
import { useEffect, useState, type ReactNode } from 'react'
import { AdminAccessNotice, AdminShell, Badge, type AdminShellProps } from '../components/admin/AdminShell'
import BranchInventoryTable from '../components/admin/BranchInventoryTable'
import InventorySimulationPanel from '../components/admin/InventorySimulationPanel'
import { useSession } from '../hooks/useSession'
import { adminProductApi, AdminProductApiError, type AdminProductErrorKind } from '../services/adminProductApi'
import type { AdminProduct } from '../types/adminProduct'
import {
  AVAILABILITY_LABELS, AVAILABILITY_TONES, B2B_STATUS_LABELS, B2B_STATUS_TONES, formatAdminMoney, formatUnits, ISSUE_LABELS,
} from '../utils/adminProductFormat'
import { EMPTY_SIMULATION, simulationsFor, type InventorySimulationAction, type InventorySimulationState } from '../utils/inventorySimulation'
import styles from '../styles/admin/AdminProducts.module.css'

type DetailState = { status: 'loading' } | { status: 'error'; kind: AdminProductErrorKind } | { status: 'ready'; product: AdminProduct }

interface SimulationProps {
  simulation: InventorySimulationState
  onSimulationChange: (action: InventorySimulationAction) => void
}

function ProductDetail({ product, userId, simulation, onSimulationChange }: { product: AdminProduct; userId: string } & SimulationProps) {
  const simulated = simulationsFor(simulation, userId, product.id)
  const { pricing, inventory } = product
  return (
    <>
      <div className={styles.detailHeader}>
        {product.image ? <img className={styles.detailImage} src={product.image} alt={product.title} width={160} height={160} /> : null}
        <div className={styles.identity}>
          <h2 className={styles.productTitle}>{product.title}</h2>
          <span className={styles.badges}>
            <Badge tone={AVAILABILITY_TONES[inventory.availability]}>{AVAILABILITY_LABELS[inventory.availability]}</Badge>
            <Badge tone={B2B_STATUS_TONES[pricing.b2bStatus]}>{B2B_STATUS_LABELS[pricing.b2bStatus]}</Badge>
            {inventory.insufficientForMoq ? <Badge tone="warning">Ninguna sucursal alcanza el MOQ</Badge> : null}
          </span>
        </div>
      </div>
      {product.issues.length ? (
        <div className={styles.error} role="alert">
          <p>Se detectaron inconsistencias en el catálogo. Se muestran los valores originales, sin corregirlos:</p>
          <ul>{product.issues.map(issue => <li key={issue}>{ISSUE_LABELS[issue]}</li>)}</ul>
        </div>
      ) : null}
      <div className={styles.detailGrid}>
        <section className={styles.panel} aria-labelledby="admin-product-identity">
          <h2 id="admin-product-identity">Identificación</h2>
          <dl className={styles.info}>
            <div><dt>Product ID</dt><dd className={styles.code}>{product.id}</dd></div>
            <div><dt>SKU</dt><dd className={styles.code}>{product.sku ?? 'No registrado'}</dd></div>
            <div><dt>Marca</dt><dd>{product.brand ?? 'No registrada'}</dd></div>
            <div><dt>Categorías</dt><dd>{product.categories.length ? product.categories.join(' › ') : 'Sin categoría'}</dd></div>
          </dl>
        </section>
        <section className={styles.panel} aria-labelledby="admin-product-pricing">
          <h2 id="admin-product-pricing">Precios y condiciones</h2>
          <dl className={styles.info}>
            <div><dt>Precio Retail (B2C)</dt><dd className={styles.price}>{formatAdminMoney(pricing.retailPrice)}</dd></div>
            <div><dt>Precio Wholesale (B2B)</dt><dd className={styles.price}>{formatAdminMoney(pricing.wholesalePrice)}</dd></div>
            <div><dt>Disponibilidad B2B</dt><dd>{pricing.b2bAvailable === null ? 'No registrada' : pricing.b2bAvailable ? 'Habilitado' : 'Deshabilitado'}</dd></div>
            <div><dt>MOQ B2B</dt><dd>{pricing.minOrderQuantity === null ? 'No definido' : formatUnits(pricing.minOrderQuantity)}</dd></div>
          </dl>
          {pricing.b2bStatus !== 'eligible' && pricing.wholesalePrice !== null
            ? <p className={styles.hint}>El precio mayorista se muestra como referencia: el producto no es comprable por B2B.</p> : null}
        </section>
        <section className={styles.panel} aria-labelledby="admin-product-stock">
          <h2 id="admin-product-stock">Inventario</h2>
          <dl className={styles.info}>
            <div><dt>Stock global del catálogo</dt><dd>{formatUnits(inventory.globalStock)}</dd></div>
            <div><dt>Suma de las sucursales</dt><dd>{formatUnits(inventory.branchTotal)}</dd></div>
          </dl>
          <p className={styles.hint}>El stock global no se asigna a ninguna sucursal; cada sucursal muestra solo sus propias existencias.</p>
        </section>
      </div>
      <section className={styles.panel} aria-labelledby="admin-product-branches">
        <h2 id="admin-product-branches">Existencias por sucursal</h2>
        <BranchInventoryTable branches={inventory.branches} simulated={simulated} caption={`Existencias por sucursal de ${product.title}`} />
      </section>
      <InventorySimulationPanel product={product} ownerId={userId} entries={simulated} onSimulationChange={onSimulationChange} />
    </>
  )
}

function AdminProductLoader({ userId, productId, onBack, simulation, onSimulationChange }: { userId: string; productId: string; onBack: () => void } & SimulationProps) {
  const [state, setState] = useState<DetailState>({ status: 'loading' })
  const [reload, setReload] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    adminProductApi.get(userId, productId, controller.signal).then(
      product => { if (!controller.signal.aborted) setState({ status: 'ready', product }) },
      error => { if (!controller.signal.aborted) setState({ status: 'error', kind: error instanceof AdminProductApiError ? error.kind : 'unavailable' }) },
    )
    return () => controller.abort()
  }, [userId, productId, reload])

  let content: ReactNode
  if (state.status === 'loading') content = <p className={styles.status} role="status" aria-busy="true">Cargando producto…</p>
  else if (state.status === 'ready') content = <ProductDetail product={state.product} userId={userId} simulation={simulation} onSimulationChange={onSimulationChange} />
  else if (state.kind === 'session' || state.kind === 'forbidden') content = <AdminAccessNotice kind={state.kind} />
  else if (state.kind === 'not-found') {
    content = (
      <div className={styles.notice} role="status">
        <h2>Producto no encontrado</h2>
        <p>El producto solicitado no existe en el catálogo.</p>
      </div>
    )
  } else {
    content = (
      <div className={styles.error} role="alert">
        <p>No pudimos consultar el producto en este momento. Ningún dato fue modificado.</p>
        <button type="button" className={styles.secondaryButton} onClick={() => { setState({ status: 'loading' }); setReload(value => value + 1) }}>Reintentar</button>
      </div>
    )
  }
  return (
    <>
      <div className={styles.actions}>
        <button type="button" className={styles.secondaryButton} onClick={onBack}>Volver a productos</button>
      </div>
      {content}
    </>
  )
}

export default function AdminProductDetailPage({ productId, onBack, simulation = EMPTY_SIMULATION, onSimulationChange = () => {}, ...shell }:
  AdminShellProps & { productId: string; onBack: () => void } & Partial<SimulationProps>) {
  const { user } = useSession()
  let content: ReactNode
  if (!user) content = <AdminAccessNotice kind="session" />
  else if (user.role !== 'ADMIN') content = <AdminAccessNotice kind="forbidden" />
  else content = <AdminProductLoader key={user.id + ':' + productId} userId={user.id} productId={productId} onBack={onBack}
    simulation={simulation} onSimulationChange={onSimulationChange} />
  return <AdminShell {...shell} title="Detalle del producto">{content}</AdminShell>
}
