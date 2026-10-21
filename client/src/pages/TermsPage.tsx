import PolicyLayout from '../components/policies/PolicyLayout'
import PolicySection from '../components/policies/PolicySection'
import TermsContent from '../components/policies/TermsContent'
import { termsPolicy } from '../content/terms'
import { isSameTabNavigation, type CatalogHash, type PolicyView } from '../utils/appNavigation'

interface TermsPageProps {
  onCatalogClick: (hash?: CatalogHash) => void
  onPolicyNavigate: (view: PolicyView) => void
  onCartClick: () => void
}

/** App mantiene el historial hash y enfoca el título al entrar, igual que las demás políticas. */
function TermsPage(navigation: TermsPageProps) {
  return (
    <PolicyLayout title={termsPolicy.title} introduction={termsPolicy.introduction} {...navigation}>
      <TermsContent />
      <PolicySection title="Continúa explorando">
        <p>Puedes consultar las demás políticas desde el pie de página o regresar a los productos de CiberNova.</p>
        <a href="#catalog" onClick={event => {
          if (!isSameTabNavigation(event)) return
          event.preventDefault()
          navigation.onCatalogClick('#catalog')
        }}>Volver al catálogo</a>
      </PolicySection>
    </PolicyLayout>
  )
}

export default TermsPage
