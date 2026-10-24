/** Lista de preguntas expandibles, genérica y reutilizable.
 * Usa <details>/<summary> nativos a propósito: el navegador gestiona el
 * estado abierto/cerrado, el foco mediante teclado (Enter / Space) y expone
 * el estado de expansión a la accesibilidad sin atributos ARIA manuales ni
 * dependencias externas.
 */
import type { ReactNode } from 'react'
import styles from '../../styles/faq/Accordion.module.css'

export interface AccordionItem {
  readonly id: string
  readonly question: string
  readonly answer: ReactNode
}

interface AccordionProps {
  items: readonly AccordionItem[]
}

function Accordion({ items }: AccordionProps) {
  return (
    <div className={styles.accordion}>
      {items.map(item => (
        <details key={item.id} className={styles.item}>
          <summary className={styles.summary}>{item.question}</summary>
          <div className={styles.answer}>{item.answer}</div>
        </details>
      ))}
    </div>
  )
}

export default Accordion