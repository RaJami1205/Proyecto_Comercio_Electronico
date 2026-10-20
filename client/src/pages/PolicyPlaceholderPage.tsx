/** Prepara los cinco destinos informativos sin anticipar su contenido comercial definitivo. */
import PolicyLayout from '../components/policies/PolicyLayout'
import PolicySection from '../components/policies/PolicySection'
import { isSameTabNavigation, type CatalogHash, type PolicyDestination, type PolicyView } from '../utils/appNavigation'

interface PolicyPlaceholderPageProps {
  destination: PolicyDestination
  onCatalogClick: (hash?: CatalogHash) => void
  onPolicyNavigate: (view: PolicyView) => void
  onCartClick: () => void
}

/** Identifica el destino solicitado y ofrece una salida al catálogo mientras se prepara su contenido. */
function PolicyPlaceholderPage({ destination, ...navigation }: PolicyPlaceholderPageProps) {
  return (
    <PolicyLayout title={destination.title} {...navigation}>
      <PolicySection title="Contenido en preparación">
        <p>Estamos preparando la información de esta sección. Su contenido estará disponible próximamente.</p>
        <a href="#catalog" onClick={event => {
          if (!isSameTabNavigation(event)) return
          event.preventDefault()
          navigation.onCatalogClick('#catalog')
        }}>Volver al catálogo</a>
      </PolicySection>
    </PolicyLayout>
  )
}

export default PolicyPlaceholderPage
