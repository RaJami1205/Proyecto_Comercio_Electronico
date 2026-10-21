import PolicyLayout from '../components/policies/PolicyLayout'
import PolicySection from '../components/policies/PolicySection'
import { returnsPolicy } from '../content/returnsPolicy'
import { isSameTabNavigation, type CatalogHash, type PolicyView } from '../utils/appNavigation'

interface ReturnsPolicyPageProps {
  onCatalogClick: (hash?: CatalogHash) => void
  onPolicyNavigate: (view: PolicyView) => void
  onCartClick: () => void
}

/** Conserva el layout, foco e historial aprobados para las páginas comerciales. */
function ReturnsPolicyPage(navigation: ReturnsPolicyPageProps) {
  return (
    <PolicyLayout title={returnsPolicy.title} introduction={returnsPolicy.introduction} {...navigation}>
      {returnsPolicy.sections.map(section => {
        const List = section.ordered ? 'ol' : 'ul'
        return (
          <PolicySection key={section.id} title={section.title}>
            {section.paragraphs.map(paragraph => <p key={paragraph}>{paragraph}</p>)}
            {section.items ? <List>{section.items.map(item => <li key={item}>{item}</li>)}</List> : null}
          </PolicySection>
        )
      })}
      <PolicySection title="Continúa explorando">
        <p>Consulta las demás políticas desde el pie de página o vuelve a explorar los productos de CiberNova.</p>
        <a href="#catalog" onClick={event => {
          if (!isSameTabNavigation(event)) return
          event.preventDefault()
          navigation.onCatalogClick('#catalog')
        }}>Volver al catálogo</a>
      </PolicySection>
    </PolicyLayout>
  )
}

export default ReturnsPolicyPage
