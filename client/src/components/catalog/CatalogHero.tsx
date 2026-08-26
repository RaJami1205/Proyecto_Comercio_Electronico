import styles from './CatalogHero.module.css'

function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="11" cy="11" r="7" />
      <path d="m16.25 16.25 4 4" />
    </svg>
  )
}

function CatalogHero() {
  return (
    <section className={styles.hero} id="top" aria-labelledby="hero-title">
      <div className={styles.ambientGlow} aria-hidden="true" />

      <div className={styles.container}>
        <div className={styles.content}>
          <p className={styles.eyebrow}>
            <span aria-hidden="true" />
            Tecnología para avanzar
          </p>
          <h1 id="hero-title">
            Explora el universo <span>CiberNova</span>
          </h1>
          <p className={styles.description}>
            Computación, electrónica y accesorios en un catálogo creado para descubrir
            tecnología con claridad.
          </p>

          <div className={styles.search} role="search" aria-label="Búsqueda de productos">
            <label className={styles.visuallyHidden} htmlFor="catalog-search">
              Buscar en el catálogo
            </label>
            <span className={styles.searchIcon}>
              <SearchIcon />
            </span>
            <input
              id="catalog-search"
              type="search"
              placeholder="Buscar laptops, componentes, accesorios..."
            />
            <button type="button">Buscar</button>
          </div>
          <p className={styles.searchNote}>Interfaz de búsqueda en preparación</p>
        </div>

        <div className={styles.visual} aria-hidden="true">
          <div className={styles.visualPanel}>
            <div className={`${styles.orbit} ${styles.orbitOuter}`} />
            <div className={`${styles.orbit} ${styles.orbitInner}`} />
            <div className={styles.core}>
              <span>CN</span>
            </div>
            <span className={`${styles.node} ${styles.nodeOne}`} />
            <span className={`${styles.node} ${styles.nodeTwo}`} />
            <span className={`${styles.node} ${styles.nodeThree}`} />
            <span className={`${styles.tag} ${styles.tagOne}`}>Hardware</span>
            <span className={`${styles.tag} ${styles.tagTwo}`}>Movilidad</span>
            <span className={`${styles.tag} ${styles.tagThree}`}>Conectividad</span>
          </div>
        </div>
      </div>
    </section>
  )
}

export default CatalogHero
