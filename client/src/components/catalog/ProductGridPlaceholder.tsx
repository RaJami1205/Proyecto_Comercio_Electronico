import styles from '../../styles/catalog/ProductGridPlaceholder.module.css'

function ProductCardPlaceholder() {
  return (
    <article className={styles.card} aria-hidden="true">
      <div className={styles.imagePlaceholder}>
        <span />
      </div>
      <div className={styles.cardBody}>
        <div className={`${styles.line} ${styles.lineLong}`} />
        <div className={`${styles.line} ${styles.lineMedium}`} />
        <div className={styles.cardFooter}>
          <div className={`${styles.line} ${styles.linePrice}`} />
          <div className={styles.buttonPlaceholder} />
        </div>
      </div>
    </article>
  )
}

function ProductGridPlaceholder() {
  return (
    <section className={styles.section} aria-labelledby="grid-preview-title">
      <h3 className={styles.visuallyHidden} id="grid-preview-title">
        Vista previa del espacio para productos
      </h3>
      <div className={styles.grid}>
        <ProductCardPlaceholder />
        <ProductCardPlaceholder />
        <ProductCardPlaceholder />
        <ProductCardPlaceholder />
        <ProductCardPlaceholder />
        <ProductCardPlaceholder />
        <ProductCardPlaceholder />
        <ProductCardPlaceholder />
      </div>
      <p className={styles.note}>Los productos estarán disponibles en una próxima iteración.</p>
    </section>
  )
}

export default ProductGridPlaceholder
