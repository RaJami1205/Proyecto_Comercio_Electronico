/** Layout y avisos de acceso de las vistas administrativas; reutiliza Header y Footer existentes. */
import type { ReactNode } from 'react'
import Header from '../layout/Header'
import Footer from '../layout/Footer'
import { useSession } from '../../hooks/useSession'
import type { CatalogHash, PolicyView } from '../../utils/appNavigation'
import styles from '../../styles/admin/AdminProducts.module.css'

export interface AdminShellProps {
  onCatalogClick: (hash?: CatalogHash) => void
  onPolicyNavigate: (view: PolicyView) => void
  onCartClick: () => void
}

export function AdminShell({ onCatalogClick, onPolicyNavigate, onCartClick, title, introduction, children, section = 'products' }: AdminShellProps & {
  /** Sección administrativa activa en el Header. */
  section?: 'products' | 'orders'
  title: string
  introduction?: string
  children: ReactNode
}) {
  return (
    <div className={styles.page}>
      <Header adminProductsView={section === 'products'} adminOrdersView={section === 'orders'} onCatalogClick={() => onCatalogClick('#catalog')} onCartClick={onCartClick} />
      <main className={styles.main}>
        <div className={styles.container}>
          <p className={styles.eyebrow}>Administración · Solo consulta</p>
          <h1 className={styles.title} tabIndex={-1} data-app-heading>{title}</h1>
          {introduction ? <p className={styles.introduction}>{introduction}</p> : null}
          {children}
        </div>
      </main>
      <Footer onCatalogClick={onCatalogClick} onPolicyNavigate={onPolicyNavigate} />
    </div>
  )
}

/** Sin Session se invita a elegir identidad; otros roles reciben acceso no autorizado. */
export function AdminAccessNotice({ kind, subject = 'products' }: { kind: 'session' | 'forbidden'; subject?: 'products' | 'orders' }) {
  const session = useSession()
  const scope = subject === 'orders' ? 'las órdenes de todos los compradores' : 'productos, precios e inventario por sucursal'
  if (kind === 'forbidden') {
    return (
      <div className={styles.notice} role="alert">
        <h2>Acceso no autorizado</h2>
        <p>La consulta administrativa de {scope} está disponible solo para el rol ADMIN.</p>
      </div>
    )
  }
  return (
    <div className={styles.notice} role="status">
      <h2>Selecciona una identidad</h2>
      <p>Inicia sesión con una identidad ADMIN para consultar {scope}.</p>
      <button type="button" className={styles.primaryButton} onClick={() => session.openLogin()}
        disabled={Boolean(session.transitionBlockReason) || session.resolving}>Iniciar sesión</button>
    </div>
  )
}

/** Badge con tono semántico; el texto siempre acompaña al color. */
export function Badge({ tone, children }: { tone: 'neutral' | 'success' | 'danger' | 'warning'; children: ReactNode }) {
  return <span className={styles.badge} data-tone={tone}>{children}</span>
}
