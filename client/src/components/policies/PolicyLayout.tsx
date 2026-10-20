/** Compone los landmarks y la superficie de lectura compartidos por los destinos informativos. */
import type { ReactNode } from 'react'
import Header from '../layout/Header'
import Footer from '../layout/Footer'
import type { CatalogHash, PolicyView } from '../../utils/appNavigation'
import styles from '../../styles/policies/PolicyLayout.module.css'

interface PolicyLayoutProps {
  title: string
  introduction?: string
  children: ReactNode
  onCatalogClick: (hash?: CatalogHash) => void
  onPolicyNavigate: (view: PolicyView) => void
  onCartClick: () => void
}

/** Presenta título y contenido; App conserva la navegación y enfoca el heading visible tras cada cambio de vista. */
function PolicyLayout({ title, introduction, children, onCatalogClick, onPolicyNavigate, onCartClick }: PolicyLayoutProps) {
  return (
    <div className={styles.page}>
      <Header policyView onCatalogClick={() => onCatalogClick('#catalog')} onCartClick={onCartClick} />
      <main className={styles.main}>
        <div className={styles.container}>
          <p className={styles.eyebrow}>Información y políticas</p>
          <h1 className={styles.title} tabIndex={-1} data-app-heading>{title}</h1>
          {introduction ? <p className={styles.introduction}>{introduction}</p> : null}
          <div className={styles.content}>{children}</div>
        </div>
      </main>
      <Footer onCatalogClick={onCatalogClick} onPolicyNavigate={onPolicyNavigate} />
    </div>
  )
}

export default PolicyLayout
