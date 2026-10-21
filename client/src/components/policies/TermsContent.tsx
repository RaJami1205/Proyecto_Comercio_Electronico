import { termsPolicy } from '../../content/terms'
import PolicySection from './PolicySection'
import styles from '../../styles/policies/PolicyLayout.module.css'

/** Contenido reutilizable sin Header, Footer, navegación ni controles de consentimiento. */
function TermsContent() {
  const publishedDate = new Intl.DateTimeFormat('es-CR', { dateStyle: 'long', timeZone: 'UTC' }).format(new Date(termsPolicy.publishedAt + 'T00:00:00Z'))
  return (
    <>
      <p className={styles.introduction}>Versión vigente: <strong>{termsPolicy.version}</strong><br />
        Publicada el <time dateTime={termsPolicy.publishedAt}>{publishedDate}</time>.
      </p>
      {termsPolicy.sections.map(section => (
        <PolicySection key={section.id} title={section.title}>
          {section.paragraphs.map(paragraph => <p key={paragraph}>{paragraph}</p>)}
          {section.items ? <ul>{section.items.map(item => <li key={item}>{item}</li>)}</ul> : null}
        </PolicySection>
      ))}
    </>
  )
}

export default TermsContent
