/** Tarjeta de una métrica local; presenta el valor real recibido sin animaciones que lo alteren. */
import type { ReactNode } from 'react'
import styles from '../../styles/analytics/MetricCard.module.css'

export type MetricTone = 'views' | 'searches' | 'cart' | 'purchases'

interface MetricCardProps {
  id: string
  label: string
  value: number
  description: string
  tone: MetricTone
  icon: ReactNode
}

const countFormatter = new Intl.NumberFormat('es-CR', { maximumFractionDigits: 0 })

function MetricCard({ id, label, value, description, tone, icon }: MetricCardProps) {
  return (
    <article className={`${styles.card} ${styles[tone]}`} aria-labelledby={`${id}-label`} data-metric={id}>
      <div className={styles.icon} aria-hidden="true">{icon}</div>
      <h2 id={`${id}-label`} className={styles.label}>{label}</h2>
      <p className={styles.value} aria-describedby={`${id}-description`}>{countFormatter.format(value)}</p>
      <p id={`${id}-description`} className={styles.description}>{description}</p>
    </article>
  )
}

export default MetricCard
