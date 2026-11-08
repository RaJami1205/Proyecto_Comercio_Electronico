/** Analytics Dashboard (CN-74): cuatro métricas locales agregadas leídas desde Analytics Core.
 * No registra eventos, no persiste datos propios y no consulta Orders, PostgreSQL ni Algolia.
 */
import Header from '../components/layout/Header'
import Footer from '../components/layout/Footer'
import MetricCard from '../components/analytics/MetricCard'
import { useSession } from '../hooks/useSession'
import { useAnalyticsMetrics, type DashboardMetrics } from '../hooks/useAnalyticsMetrics'
import type { CatalogHash, PolicyView } from '../utils/appNavigation'
import type { MetricTone } from '../components/analytics/MetricCard'
import type { ReactNode } from 'react'
import styles from '../styles/analytics/AnalyticsDashboardPage.module.css'

interface AnalyticsDashboardPageProps {
  onCatalogClick: (hash?: CatalogHash) => void
  onPolicyNavigate: (view: PolicyView) => void
  onCartClick: () => void
}

/** Envuelve los trazos de cada KPI en un icono que queda fuera del recorrido de foco. */
const svg = (children: ReactNode) => <svg viewBox="0 0 24 24" focusable="false">{children}</svg>

const metricDefinitions: ReadonlyArray<{ key: keyof DashboardMetrics; label: string; description: string; tone: MetricTone; icon: ReactNode }> = [
  { key: 'productViews', label: 'Productos vistos', description: 'Aperturas de detalles de productos registradas.', tone: 'views',
    icon: svg(<><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" /></>) },
  { key: 'searches', label: 'Búsquedas', description: 'Búsquedas ejecutadas en el catálogo.', tone: 'searches',
    icon: svg(<><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></>) },
  { key: 'cartAdditions', label: 'Agregados al carrito', description: 'Acciones de agregar al carrito, sin importar las unidades.', tone: 'cart',
    icon: svg(<><path d="M3 4h2l2.2 10.1a2 2 0 0 0 2 1.6h7.9a2 2 0 0 0 1.9-1.4L21 8H7" /><circle cx="10" cy="20" r="1.3" /><circle cx="18" cy="20" r="1.3" /></>) },
  { key: 'completedPurchases', label: 'Compras completadas', description: 'Órdenes distintas confirmadas con pago aprobado.', tone: 'purchases',
    icon: svg(<><path d="M5 8h14l-1 12H6L5 8Z" /><path d="M9 8V6a3 3 0 0 1 6 0v2" /><path d="m9.5 14 2 2 3.5-3.5" /></>) },
]

/** Suscribe la vista autorizada a los cuatro KPIs y muestra las advertencias de cobertura junto a las cifras disponibles. */
function AuthorizedAnalyticsDashboard({ onCatalogClick, onPolicyNavigate, onCartClick }: AnalyticsDashboardPageProps) {
  const session = useSession()
  const user = session.user
  const { state, retry } = useAnalyticsMetrics(user?.id)

  let content: ReactNode
  if (state.status === 'no-session') {
    content = (
      <div className={styles.notice} role="status">
        <h2>Selecciona una identidad</h2>
        <p>Inicia sesión para consultar las estadísticas de tu actividad. La actividad anónima no se atribuye a ningún usuario.</p>
        <button type="button" className={styles.primaryButton} onClick={session.openLogin}
          disabled={Boolean(session.transitionBlockReason) || session.resolving}>Iniciar sesión</button>
      </div>
    )
  } else if (state.status === 'loading') {
    content = <p className={styles.status} role="status" aria-busy="true">Cargando tus métricas…</p>
  } else if (state.status === 'error') {
    content = (
      <div className={styles.error} role="alert">
        <p>Las métricas no están disponibles en este momento. Puedes seguir comprando con normalidad.</p>
        <button type="button" className={styles.secondaryButton} onClick={retry}>Reintentar</button>
      </div>
    )
  } else {
    content = (
      <>
        {state.persistence.excludedScopes > 0 ? (
          <p className={styles.warning} role="alert">
            Se omitieron datos dañados, incompatibles o con referencias inválidas. Las métricas disponibles pueden estar incompletas.
          </p>
        ) : null}
        {state.persistence.unavailable ? <p className={styles.warning} role="status">
          No se pudo leer todo el almacenamiento local. Se muestra únicamente la actividad disponible.
        </p> : null}
        {state.persistence.memoryOnly ? (
          <p className={styles.warning} role="status">
            Parte de la actividad actual se conserva solo en memoria y puede perderse al recargar.
          </p>
        ) : null}
        {state.isEmpty ? (
          <p className={styles.status} role="status">
            Todavía no hay actividad registrada. Las interacciones de usuarios y visitantes aparecerán aquí.
          </p>
        ) : null}
        <div className={styles.grid}>
          {metricDefinitions.map(metric => (
            <MetricCard key={metric.key} id={`metric-${metric.key}`} label={metric.label} value={state.metrics[metric.key]}
              description={metric.description} tone={metric.tone} icon={metric.icon} />
          ))}
        </div>
      </>
    )
  }

  return (
    <div className={styles.page}>
      <Header analyticsView onCatalogClick={() => onCatalogClick('#catalog')} onCartClick={onCartClick} />
      <main className={styles.main}>
        <div className={styles.container}>
          <p className={styles.eyebrow}>Analytics</p>
          <h1 className={styles.title} tabIndex={-1} data-app-heading>Analytics Dashboard</h1>
          <p className={styles.introduction}>
            Resumen de la actividad local registrada en CiberNova: productos vistos, búsquedas, agregados al carrito y compras completadas.
          </p>
          <p className={styles.scope}>
            <strong>Estadísticas agregadas de usuarios y visitantes de este navegador.</strong>{' '}
            No son estadísticas globales de CiberNova.
          </p>
          <section className={styles.content} aria-label="Métricas de actividad" aria-busy={state.status === 'loading'}>
            {content}
          </section>
        </div>
      </main>
      <Footer onCatalogClick={onCatalogClick} onPolicyNavigate={onPolicyNavigate} />
    </div>
  )
}

/** El contenido y su hook solo se montan para una identidad ADMIN resuelta por SessionContext. */
export default function AnalyticsDashboardPage(props: AnalyticsDashboardPageProps) {
  const { user } = useSession()
  return user?.role === 'ADMIN' ? <AuthorizedAnalyticsDashboard key={user.id} {...props} /> : null
}
