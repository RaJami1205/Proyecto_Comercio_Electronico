/** Página informativa de Preguntas Frecuentes (CN-45). Reutiliza PolicyLayout
 * y un Accordion genérico; no modifica Cart, Checkout, Payment ni Order.
 */
import PolicyLayout from '../components/policies/PolicyLayout'
import Accordion from '../components/faq/Accordion'
import { faqEntries } from '../content/faq'
import { isSameTabNavigation } from '../utils/appNavigation'
import type { CatalogHash, PolicyView } from '../utils/appNavigation'
import styles from '../styles/faq/FaqPage.module.css'

interface FaqPageProps {
  onCatalogClick: (hash?: CatalogHash) => void
  onPolicyNavigate: (view: PolicyView) => void
  onCartClick: () => void
}

function FaqPage({ onCatalogClick, onPolicyNavigate, onCartClick }: FaqPageProps) {
  const items = faqEntries.map(entry => ({
    id: entry.id,
    question: entry.question,
    answer: (
      <>
        {entry.paragraphs.map(paragraph => (
          <p key={paragraph}>{paragraph}</p>
        ))}
        {entry.relatedPolicy ? (
          <p>
            <button
              type="button"
              className={styles.policyLink}
              onClick={() => onPolicyNavigate(entry.relatedPolicy!.view)}
            >
              {entry.relatedPolicy.label}
            </button>
          </p>
        ) : null}
      </>
    ),
  }))

  return (
    <PolicyLayout
      title="Preguntas Frecuentes"
      introduction="Encuentra respuestas rápidas sobre compras, pagos, envíos, devoluciones, privacidad y atención al cliente en CiberNova."
      onCatalogClick={onCatalogClick}
      onPolicyNavigate={onPolicyNavigate}
      onCartClick={onCartClick}
    >
      <Accordion items={items} />

      <p className={styles.backToCatalog}>
        <a href="#catalog" onClick={event => {
          if (!isSameTabNavigation(event)) return
          event.preventDefault()
          onCatalogClick('#catalog')
        }}>Volver al catálogo</a>
      </p>
    </PolicyLayout>
  )
}

export default FaqPage