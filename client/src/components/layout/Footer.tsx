/** Reúne los enlaces y la información institucional compartidos por las vistas. */
import styles from '../../styles/layout/Footer.module.css'
import { handleAnchorNavigation } from '../../utils/scrollToAnchor'

/** Presenta las secciones informativas y delega el desplazamiento por anclas. */
function Footer({ onCatalogClick }: { onCatalogClick?: (hash: '#top' | '#catalog') => void }) {
  return (
    <footer className={styles.footer} id="about">
      <div className={styles.container}>
        <div className={styles.grid}>
          <section className={styles.brandSection} aria-labelledby="footer-brand">
            <h2 id="footer-brand">
              Ciber<span>Nova</span>
            </h2>
            <p>
              Tecnología, computación y accesorios reunidos en una experiencia de compra
              clara y moderna.
            </p>
          </section>

          <section aria-labelledby="footer-categories">
            <h3 id="footer-categories">Categorías</h3>
            <ul>
              <li>Computadoras</li>
              <li>Componentes</li>
              <li>Periféricos</li>
              <li>Accesorios</li>
            </ul>
          </section>

          <section aria-labelledby="footer-links">
            <h3 id="footer-links">Explorar</h3>
            <ul>
              <li>
                <a href="#top" onClick={(event) => {
                  if (onCatalogClick) { event.preventDefault(); onCatalogClick('#top') }
                  else handleAnchorNavigation(event)
                }}>
                  Inicio
                </a>
              </li>
              <li>
                <a href="#catalog" onClick={(event) => {
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

          <section aria-labelledby="footer-help">
            <h3 id="footer-help">Ayuda</h3>
            <ul>
              <li>Centro de ayuda</li>
              <li>Guía de compra</li>
              <li>Garantías</li>
              <li>Preguntas frecuentes</li>
            </ul>
          </section>
        </div>

        <div className={styles.bottom}>
          <p>© 2026 CiberNova. Todos los derechos reservados.</p>
          <div className={styles.legal} aria-label="Información legal">
            <span>Privacidad</span>
            <span>Términos</span>
            <span>Accesibilidad</span>
          </div>
        </div>
      </div>
    </footer>
  )
}

export default Footer
