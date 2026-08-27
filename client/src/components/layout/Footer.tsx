import styles from '../../styles/layout/Footer.module.css'
import { handleAnchorNavigation } from '../../utils/scrollToAnchor'

function Footer() {
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
                <a href="#top" onClick={handleAnchorNavigation}>
                  Inicio
                </a>
              </li>
              <li>
                <a href="#catalog" onClick={handleAnchorNavigation}>
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
