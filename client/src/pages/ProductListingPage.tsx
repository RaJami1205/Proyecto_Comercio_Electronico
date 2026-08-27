import { useEffect, useRef, useState } from 'react'

import CatalogHero from '../components/catalog/CatalogHero'
import CatalogToolbar from '../components/catalog/CatalogToolbar'
import Pagination from '../components/catalog/Pagination'
import ProductGrid from '../components/catalog/ProductGrid'
import ProductQuickView from '../components/catalog/ProductQuickView'
import Footer from '../components/layout/Footer'
import Header from '../components/layout/Header'
import { products, type Product } from '../data/products'
import styles from '../styles/pages/ProductListingPage.module.css'
import { scrollToElement } from '../utils/scrollToAnchor'

const DESKTOP_PAGE_SIZE = 12
const COMPACT_PAGE_SIZE = 6
const DESKTOP_MEDIA_QUERY = '(min-width: 1061px)'

function getPageSize() {
  return window.matchMedia(DESKTOP_MEDIA_QUERY).matches
    ? DESKTOP_PAGE_SIZE
    : COMPACT_PAGE_SIZE
}

function ProductListingPage() {
  const [currentPage, setCurrentPage] = useState(1)
  const [pageSize, setPageSize] = useState(getPageSize)
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null)
  const resultsStartRef = useRef<HTMLDivElement>(null)

  const totalPages = Math.ceil(products.length / pageSize)
  const startIndex = (currentPage - 1) * pageSize
  const visibleProducts = products.slice(startIndex, startIndex + pageSize)

  useEffect(() => {
    const desktopMedia = window.matchMedia(DESKTOP_MEDIA_QUERY)

    function handleBreakpointChange(event: MediaQueryListEvent) {
      setPageSize(event.matches ? DESKTOP_PAGE_SIZE : COMPACT_PAGE_SIZE)
      setCurrentPage(1)
    }

    desktopMedia.addEventListener('change', handleBreakpointChange)

    return () => desktopMedia.removeEventListener('change', handleBreakpointChange)
  }, [])

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
              productCount={products.length}
              onSearchChange={() => setCurrentPage(1)}
            />

            <div className={styles.results} ref={resultsStartRef}>
              <ProductGrid
                key={`${currentPage}-${pageSize}`}
                products={visibleProducts}
                currentPage={currentPage}
                totalPages={totalPages}
                onProductSelect={setSelectedProduct}
              />
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
