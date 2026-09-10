import { useCallback, useRef, useState } from 'react'

import CatalogFilters from '../components/catalog/CatalogFilters'
import CatalogHero from '../components/catalog/CatalogHero'
import CatalogToolbar, { type ActivePanel } from '../components/catalog/CatalogToolbar'
import Pagination from '../components/catalog/Pagination'
import ProductGrid from '../components/catalog/ProductGrid'
import ProductQuickView from '../components/catalog/ProductQuickView'
import Footer from '../components/layout/Footer'
import Header from '../components/layout/Header'
import type { Product } from '../data/products'
import { useCatalogPagination } from '../hooks/useCatalogPagination'
import { useProductCatalog } from '../hooks/useProductCatalog'
import type { CatalogFilters as CatalogFiltersState } from '../services/productApi'
import styles from '../styles/pages/ProductListingPage.module.css'
import { scrollToElement } from '../utils/scrollToAnchor'

const EMPTY_FILTERS: CatalogFiltersState = {
  categories: [],
  brands: [],
  specifications: {},
  minPrice: '',
  maxPrice: '',
}

function ProductListingPage() {
  const { currentPage, pageSize, setCurrentPage } = useCatalogPagination()
  const [filters, setFilters] = useState<CatalogFiltersState>(EMPTY_FILTERS)
  const [catalogQuery, setCatalogQuery] = useState('')
  
  // Reemplazamos 'isFiltersOpen' por 'activePanel'
  const [activePanel, setActivePanel] = useState<ActivePanel>(null)
  
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null)
  const resultsStartRef = useRef<HTMLDivElement>(null)

  const { products, totalPages, nbHits, facets, isLoading, error } =
    useProductCatalog(currentPage, pageSize, filters, catalogQuery)

  const handleSearchChange = useCallback((query: string) => {
    if (query === catalogQuery) return
    setCatalogQuery(query)
    setCurrentPage(1)
  }, [catalogQuery, setCurrentPage])

  function handleFiltersChange(nextFilters: CatalogFiltersState) {
    setFilters(nextFilters)
    setCurrentPage(1)
  }

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

            {/* Pasamos el estado del panel activo y la función para cambiarlo */}
            <CatalogToolbar
              productCount={nbHits}
              activePanel={activePanel}
              onTogglePanel={setActivePanel}
              onSearchChange={handleSearchChange}
              onProductSelect={setSelectedProduct}
            />

            {/* CatalogFilters ahora renderiza internamente solo la sección según 'activePanel' */}
            <CatalogFilters
              facets={facets}
              filters={filters}
              onChange={handleFiltersChange}
              activePanel={activePanel}
            />

            <div className={styles.results} ref={resultsStartRef}>
              {error ? (
                <p className={styles.description} role="alert">
                  {error}
                </p>
              ) : !isLoading && products.length === 0 ? (
                <p className={styles.description} role="status">
                  {catalogQuery
                    ? 'No encontramos productos para esta búsqueda.'
                    : 'No encontramos productos con los filtros actuales.'}
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
