/** Presenta una sección semántica de contenido informativo con título de segundo nivel. */
import { useId, type ReactNode } from 'react'
import styles from '../../styles/policies/PolicyLayout.module.css'

interface PolicySectionProps {
  title: string
  children: ReactNode
}

/** Asocia la sección con un heading único y conserva la estructura de sus hijos. */
function PolicySection({ title, children }: PolicySectionProps) {
  const headingId = useId()
  return (
    <section className={styles.section} aria-labelledby={headingId}>
      <h2 id={headingId}>{title}</h2>
      {children}
    </section>
  )
}

export default PolicySection
