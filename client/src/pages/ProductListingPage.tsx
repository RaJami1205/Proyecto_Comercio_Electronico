import { useRef, useState } from 'react'

import CatalogHero from '../components/catalog/CatalogHero'
import CatalogToolbar from '../components/catalog/CatalogToolbar'
import Pagination from '../components/catalog/Pagination'
import ProductGrid from '../components/catalog/ProductGrid'
import ProductQuickView from '../components/catalog/ProductQuickView'
import Footer from '../components/layout/Footer'
import Header from '../components/layout/Header'
import type { Product } from '../data/products'
import { useProductCatalog } from '../hooks/useProductCatalog'
import styles from '../styles/pages/ProductListingPage.module.css'
import { scrollToElement } from '../utils/scrollToAnchor'

function ProductListingPage() {
  const [currentPage, setCurrentPage] = useState(1)
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null)
  const resultsStartRef = useRef<HTMLDivElement>(null)

  // Controlador: la página completa (20 productos, según la
  // paginación ya configurada en el índice de Algolia) viene de aquí.
  const { products, totalPages, nbHits, isLoading, error } =
    useProductCatalog(currentPage)

  function handleDirectionalPageChange(page: number) {
    setCurrentPage(page)

    requestAnimationFrame(() => {
      if (resultsStartRef.current) {
        scrollToElement(resultsStartRef.current)
      }
    })
  }

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

            <CatalogToolbar
              productCount={nbHits}
              onSearchChange={() => setCurrentPage(1)}
            />

            <div className={styles.results} ref={resultsStartRef}>
              {error ? (
                <p className={styles.description} role="alert">
                  {error}
                </p>
              ) : (
                <ProductGrid
                  key={currentPage}
                  products={products}
                  currentPage={currentPage}
                  totalPages={totalPages}
                  onProductSelect={setSelectedProduct}
                />
              )}

              {isLoading ? (
                <p className={styles.description} aria-live="polite">
                  Cargando productos…
                </p>
              ) : null}

              <Pagination
                currentPage={currentPage}
                totalPages={totalPages}
                onPageChange={setCurrentPage}
                onDirectionalPageChange={handleDirectionalPageChange}
              />
            </div>
          </div>
        </section>
      </main>

      <Footer />

      {selectedProduct ? (
        <ProductQuickView
          product={selectedProduct}
          onClose={() => setSelectedProduct(null)}
        />
      ) : null}
    </div>
  )
}

export default ProductListingPage
