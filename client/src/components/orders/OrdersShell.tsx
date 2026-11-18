/** Layout y avisos compartidos por My Orders y Order Detail; reutilizan Header y Footer existentes. */
import type { ReactNode } from 'react'
import Header from '../layout/Header'
import Footer from '../layout/Footer'
import { useSession } from '../../hooks/useSession'
import type { CatalogHash, PolicyView } from '../../utils/appNavigation'
import styles from '../../styles/orders/OrderHistory.module.css'

/** Página con Header y Footer existentes; el contenido cambia según Session, rol y estado de la consulta. */
export function OrdersShell({ ordersView = true, onCatalogClick, onPolicyNavigate, onCartClick, eyebrow, title, introduction, children }: {
  ordersView?: boolean
  onCatalogClick: (hash?: CatalogHash) => void
  onPolicyNavigate: (view: PolicyView) => void
  onCartClick: () => void
  eyebrow: string
  title: string
  introduction?: string
  children: ReactNode
}) {
  return (
    <div className={styles.page}>
      <Header ordersView={ordersView} onCatalogClick={() => onCatalogClick('#catalog')} onCartClick={onCartClick} />
      <main className={styles.main}>
        <div className={styles.container}>
          <p className={styles.eyebrow}>{eyebrow}</p>
          <h1 className={styles.title} tabIndex={-1} data-app-heading>{title}</h1>
          {introduction ? <p className={styles.introduction}>{introduction}</p> : null}
          {children}
        </div>
      </main>
      <Footer onCatalogClick={onCatalogClick} onPolicyNavigate={onPolicyNavigate} />
    </div>
  )
}

/** Avisos compartidos por listado y detalle para Session requerida y acceso no autorizado. */
export function AccessNotice({ kind }: { kind: 'session' | 'forbidden' }) {
  const session = useSession()
  if (kind === 'forbidden') {
    return (
      <div className={styles.notice} role="alert">
        <h2>Acceso no autorizado</h2>
        <p>Esta identidad no puede consultar el historial de compras. My Orders está disponible para compradores B2C y B2B.</p>
      </div>
    )
  }
  return (
    <div className={styles.notice} role="status">
      <h2>Selecciona una identidad</h2>
      <p>Inicia sesión con un comprador B2C o B2B para consultar tus órdenes.</p>
      <button type="button" className={styles.primaryButton} onClick={() => session.openLogin()}
        disabled={Boolean(session.transitionBlockReason) || session.resolving}>Iniciar sesión</button>
    </div>
  )
}

