/** Integra la navegación principal con el contador derivado del Cart. */
import type { MouseEvent } from 'react'

import { useCart } from '../../hooks/useCart'
import { useSession } from '../../hooks/useSession'
import styles from '../../styles/layout/Header.module.css'
import { handleAnchorNavigation } from '../../utils/scrollToAnchor'
import { isSameTabNavigation } from '../../utils/appNavigation'

interface HeaderProps {
  cartView?: boolean
  checkoutView?: boolean
  policyView?: boolean
  onCartClick?: () => void
  onCatalogClick?: () => void
}

/** Presenta los accesos según la vista activa usando totalUnits de useCart. */
function Header({ cartView = false, checkoutView = false, policyView = false, onCartClick, onCatalogClick }: HeaderProps) {
  const { totalUnits } = useCart()
  const session = useSession()
  const outsideCatalog = cartView || checkoutView || policyView

  /** Permite regresar al catálogo mediante el callback de navegación o un ancla. */
  function handleCatalogNavigation(event: MouseEvent<HTMLAnchorElement>) {
    if (!isSameTabNavigation(event)) return
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
          href={outsideCatalog ? '#catalog' : '#top'}
          aria-label={outsideCatalog ? 'CiberNova, volver al catálogo' : 'CiberNova, ir al inicio'}
          onClick={outsideCatalog ? handleCatalogNavigation : handleAnchorNavigation}
        >
          <span>Ciber</span>
          <span className={styles.brandAccent}>Nova</span>
        </a>

        <nav className={styles.navigation} aria-label="Navegación principal">
          <ul>
            {outsideCatalog ? (
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

        <div className={styles.actions}>
        <div className={styles.session}>
          {session.user ? <span className={styles.identity}>
            <span className={styles.identityName} title={session.user.displayName}>{session.user.displayName}</span>
            <span className={styles.role}>{session.user.role}</span>
            {session.user.role === 'B2B' ? <small className={styles.company} title={session.user.company.name}>{session.user.company.name}</small> : null}
          </span> : <span className={styles.identity}><span className={styles.identityName}>Sin sesión</span></span>}
          <div className={styles.sessionButtons}>
            <button type="button" disabled={Boolean(session.transitionBlockReason) || session.resolving}
              aria-label={session.user ? 'Cambiar usuario' : 'Iniciar sesión'}
              aria-haspopup="dialog" onClick={event => { event.currentTarget.focus(); session.openLogin() }}>
              {session.user ? <>Cambiar<span className={styles.fullActionLabel}>&nbsp;usuario</span></> : 'Iniciar sesión'}
            </button>
            {session.user ? <button type="button" disabled={Boolean(session.transitionBlockReason) || session.resolving}
              className={styles.sessionExit}
              onClick={event => { event.currentTarget.focus(); session.requestLogout() }}>Salir</button> : null}
          </div>
          {session.transitionBlockReason ? <small className={styles.sessionHint}>{session.transitionBlockReason}</small> : null}
        </div>
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
      </div>
    </header>
  )
}

export default Header
