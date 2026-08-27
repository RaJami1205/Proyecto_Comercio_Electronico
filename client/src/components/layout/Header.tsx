import styles from '../../styles/layout/Header.module.css'
import { handleAnchorNavigation } from '../../utils/scrollToAnchor'

function Header() {
  return (
    <header className={styles.header}>
      <div className={styles.inner}>
        <a
          className={styles.brand}
          href="#top"
          aria-label="CiberNova, ir al inicio"
          onClick={handleAnchorNavigation}
        >
          <span>Ciber</span>
          <span className={styles.brandAccent}>Nova</span>
        </a>

        <nav className={styles.navigation} aria-label="Navegación principal">
          <ul>
            <li>
              <a href="#top" onClick={handleAnchorNavigation}>
                Inicio
              </a>
            </li>
            <li>
              <a href="#catalog" aria-current="page" onClick={handleAnchorNavigation}>
                Catálogo
              </a>
            </li>
            <li>
              <span className={styles.pending} title="Disponible próximamente">
                Ofertas
              </span>
            </li>
            <li>
              <a href="#about" onClick={handleAnchorNavigation}>
                Nosotros
              </a>
            </li>
          </ul>
        </nav>

        <a className={styles.action} href="#catalog" onClick={handleAnchorNavigation}>
          <span>Explorar</span>
          <svg viewBox="0 0 20 20" aria-hidden="true">
            <path d="M4 10h12m-5-5 5 5-5 5" />
          </svg>
        </a>
      </div>
    </header>
  )
}

export default Header
