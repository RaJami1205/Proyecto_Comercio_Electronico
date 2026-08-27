import HeroVisual from './HeroVisual'
import styles from '../../styles/catalog/CatalogHero.module.css'

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
        </div>

        <div className={styles.visual}>
          <HeroVisual />
        </div>
      </div>
    </section>
  )
}

export default CatalogHero
