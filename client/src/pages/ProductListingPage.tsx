import CatalogHero from '../components/catalog/CatalogHero'
import CatalogToolbar from '../components/catalog/CatalogToolbar'
import ProductGridPlaceholder from '../components/catalog/ProductGridPlaceholder'
import Footer from '../components/layout/Footer'
import Header from '../components/layout/Header'
import styles from '../styles/pages/ProductListingPage.module.css'

function ProductListingPage() {
  return (
    <div className={styles.page}>
      <Header />

      <main>
        <CatalogHero />

        <section className={styles.catalog} id="catalog" aria-labelledby="catalog-title">
          <div className={styles.container}>
            <header className={styles.introduction}>
              <div>
                <p className={styles.eyebrow}>Tecnología para cada propósito</p>
                <h2 id="catalog-title">Catálogo de productos</h2>
              </div>
              <p className={styles.description}>
                Explora un espacio diseñado para comparar computación, componentes y
                accesorios con claridad.
              </p>
            </header>

            <CatalogToolbar />
            <ProductGridPlaceholder />
          </div>
        </section>
      </main>

      <Footer />
    </div>
  )
}

export default ProductListingPage
