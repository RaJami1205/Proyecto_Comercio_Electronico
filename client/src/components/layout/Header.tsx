/** Integra la navegación principal con el contador derivado del Cart. */
import type { MouseEvent } from 'react'

import { useCart } from '../../hooks/useCart'
import styles from '../../styles/layout/Header.module.css'
import { handleAnchorNavigation } from '../../utils/scrollToAnchor'

interface HeaderProps {
  cartView?: boolean
  onCartClick?: () => void
  onCatalogClick?: () => void
}

/** Presenta los accesos según la vista activa usando totalUnits de useCart. */
function Header({ cartView = false, onCartClick, onCatalogClick }: HeaderProps) {
  const { totalUnits } = useCart()

  /** Permite regresar al catálogo mediante el callback de navegación o un ancla. */
  function handleCatalogNavigation(event: MouseEvent<HTMLAnchorElement>) {
    if (onCatalogClick) {
      event.preventDefault()
      onCatalogClick()
      return
    }

    handleAnchorNavigation(event)
  }

  return (
    <header className={styles.header}>
      <div className={styles.inner}>
        <a
          className={styles.brand}
          href={cartView ? '#catalog' : '#top'}
          aria-label={cartView ? 'CiberNova, volver al catálogo' : 'CiberNova, ir al inicio'}
          onClick={cartView ? handleCatalogNavigation : handleAnchorNavigation}
        >
          <span>Ciber</span>
          <span className={styles.brandAccent}>Nova</span>
        </a>

        <nav className={styles.navigation} aria-label="Navegación principal">
          <ul>
            {cartView ? (
              <li>
                <a href="#catalog" onClick={handleCatalogNavigation}>
                  Volver al catálogo
                </a>
              </li>
            ) : (
              <>
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
              </>
            )}
          </ul>
        </nav>

        <button
          className={styles.action}
          type="button"
          data-cart-preview-trigger
          aria-haspopup="dialog"
          aria-label={`Carrito, ${totalUnits} ${totalUnits === 1 ? 'producto' : 'productos'}`}
          onClick={(event) => {
            event.currentTarget.focus({ preventScroll: true })
            onCartClick?.()
          }}
        >
          <span className={styles.actionLabel}>Carrito</span>
          <span className={styles.cartCount} aria-hidden="true">{totalUnits}</span>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M3 4h2l2.2 10.1a2 2 0 0 0 2 1.6h7.9a2 2 0 0 0 1.9-1.4L21 8H7" />
            <circle cx="10" cy="20" r="1.3" />
            <circle cx="18" cy="20" r="1.3" />
          </svg>
        </button>
      </div>
    </header>
  )
}

export default Header
