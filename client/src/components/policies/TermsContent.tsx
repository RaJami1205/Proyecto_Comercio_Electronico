/** Comparte versión, fecha y secciones de términos entre la página pública y la consulta modal. */
import { termsPolicy } from '../../content/terms'
import PolicySection from './PolicySection'
import styles from '../../styles/policies/PolicyLayout.module.css'

/** versionRejected identifica la copia local rechazada; no descarga ni sustituye la versión del Server. */
function TermsContent({ versionRejected = false }: { versionRejected?: boolean } = {}) {
  const publishedDate = new Intl.DateTimeFormat('es-CR', { dateStyle: 'long', timeZone: 'UTC' }).format(new Date(termsPolicy.publishedAt + 'T00:00:00Z'))
  return (
    <>
      <p className={styles.introduction}>{versionRejected ? 'Versión local rechazada por el servidor' : 'Versión vigente'}: <strong>{termsPolicy.version}</strong><br />
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
