/** Reúne los enlaces y la información institucional compartidos por las vistas. */
import { useId } from 'react'
import styles from '../../styles/layout/Footer.module.css'
import { handleAnchorNavigation } from '../../utils/scrollToAnchor'
import { isSameTabNavigation, policyDestinations, type PolicyDestination, type PolicyView } from '../../utils/appNavigation'

interface FooterProps {
  onCatalogClick?: (hash: '#top' | '#catalog') => void
  onPolicyNavigate?: (view: PolicyView) => void
}

/** Presenta las secciones informativas y delega el desplazamiento por anclas. */
function Footer({ onCatalogClick, onPolicyNavigate }: FooterProps) {
  const id = useId()
  // Checkout y Confirmation no proporcionan este callback: leer información conserva su estado en la pestaña original.
  const separateTab = !onPolicyNavigate

  /** Conserva href y clicks modificados; solo delega la navegación ordinaria si existe un owner explícito. */
  function policyLink(destination: PolicyDestination, label: string = destination.title) {
    return <a href={destination.hash}
      target={separateTab ? '_blank' : undefined}
      rel={separateTab ? 'noopener noreferrer' : undefined}
      aria-describedby={separateTab ? `${id}-policy-note` : undefined}
      onClick={event => {
        if (!onPolicyNavigate || !isSameTabNavigation(event)) return
        event.preventDefault()
        onPolicyNavigate(destination.view)
      }}>{label}</a>
  }

  return (
    <footer className={styles.footer} id={!onCatalogClick ? 'about' : undefined}>
      <div className={styles.container}>
        <div className={styles.grid}>
          <section className={styles.brandSection} aria-labelledby={`${id}-brand`}>
            <h2 id={`${id}-brand`}>
              Ciber<span>Nova</span>
            </h2>
            <p>
              Tecnología, computación y accesorios reunidos en una experiencia de compra
              clara y moderna.
            </p>
          </section>

          <section aria-labelledby={`${id}-categories`}>
            <h3 id={`${id}-categories`}>Categorías</h3>
            <ul>
              <li>Computadoras</li>
              <li>Componentes</li>
              <li>Periféricos</li>
              <li>Accesorios</li>
            </ul>
          </section>

          <section aria-labelledby={`${id}-links`}>
            <h3 id={`${id}-links`}>Explorar</h3>
            <ul>
              <li>
                <a href="#top" onClick={(event) => {
                  if (!isSameTabNavigation(event)) return
                  if (onCatalogClick) { event.preventDefault(); onCatalogClick('#top') }
                  else handleAnchorNavigation(event)
                }}>
                  Inicio
                </a>
              </li>
              <li>
                <a href="#catalog" onClick={(event) => {
                  if (!isSameTabNavigation(event)) return
                  if (onCatalogClick) { event.preventDefault(); onCatalogClick('#catalog') }
                  else handleAnchorNavigation(event)
                }}>
                  Catálogo
                </a>
              </li>
              <li>Nosotros</li>
              <li>Contacto</li>
            </ul>
          </section>

          <section aria-labelledby={`${id}-help`}>
            <h3 id={`${id}-help`}>Ayuda</h3>
            <ul>
              <li>Centro de ayuda</li>
              <li>Guía de compra</li>
              <li>Garantías</li>
              <li>{policyLink(policyDestinations[4])}</li>
            </ul>
          </section>
        </div>

        <nav className={styles.policies} aria-labelledby={`${id}-policies`}>
          <h3 id={`${id}-policies`}>Información y políticas</h3>
          {separateTab ? <p id={`${id}-policy-note`}>Los enlaces informativos se abren en otra pestaña para conservar tu compra.</p> : null}
          <ul>{policyDestinations.map(destination => <li key={destination.view}>{policyLink(destination)}</li>)}</ul>
        </nav>

        <div className={styles.bottom}>
          <p>© 2026 CiberNova. Todos los derechos reservados.</p>
          <div className={styles.legal} aria-label="Información legal">
            {policyLink(policyDestinations[3], 'Privacidad')}
            {policyLink(policyDestinations[0], 'Términos')}
            <span>Accesibilidad</span>
          </div>
        </div>
      </div>
    </footer>
  )
}

export default Footer
