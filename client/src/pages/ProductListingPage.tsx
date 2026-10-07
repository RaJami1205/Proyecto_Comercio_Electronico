/** Conserva el estado del catálogo montado y delega la navegación a App. */
import { useCallback, useRef, useState } from 'react'

import CartFeedbackToast from '../components/catalog/CartFeedbackToast'
import CatalogFilters from '../components/catalog/CatalogFilters'
import CatalogHero from '../components/catalog/CatalogHero'
import CatalogToolbar, { type ActivePanel } from '../components/catalog/CatalogToolbar'
import Pagination from '../components/catalog/Pagination'
import ProductGrid from '../components/catalog/ProductGrid'
import ProductQuickView from '../components/catalog/ProductQuickView'
import Footer from '../components/layout/Footer'
import Header from '../components/layout/Header'
import type { Product } from '../types/product'
import { useCatalogPagination } from '../hooks/useCatalogPagination'
import { useProductCatalog } from '../hooks/useProductCatalog'
import type { CatalogFilters as CatalogFiltersState } from '../services/productApi'
import styles from '../styles/pages/ProductListingPage.module.css'
import { scrollToElement } from '../utils/scrollToAnchor'

export interface CartFeedback {
  productId: string
  productName: string
  source: 'catalog' | 'quick-view'
}

interface ProductListingPageProps {
  active: boolean
  isCartPreviewOpen: boolean
  onCartClick: () => void
  feedback: CartFeedback | null
  onProductAdded: (product: Pick<Product, 'id' | 'name'>, source: CartFeedback['source']) => void
}

const EMPTY_FILTERS: CatalogFiltersState = {
  categories: [],
  brands: [],
  specifications: {},
  minPrice: '',
  maxPrice: '',
}

/** Posee filtros, query, selección de Quick View y feedback temporal de presentación. */
function ProductListingPage({ active, isCartPreviewOpen, onCartClick, feedback, onProductAdded }: ProductListingPageProps) {
  const { currentPage, pageSize, setCurrentPage } = useCatalogPagination()
  const [filters, setFilters] = useState<CatalogFiltersState>(EMPTY_FILTERS)
  const [catalogQuery, setCatalogQuery] = useState('')
  
  // Un único panel activo evita desplegar grupos de filtros simultáneamente.
  const [activePanel, setActivePanel] = useState<ActivePanel>(null)
  
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null)

  const resultsStartRef = useRef<HTMLDivElement>(null)

  const { products, totalPages, nbHits, facets, isLoading, error } =
    useProductCatalog(currentPage, pageSize, filters, catalogQuery)

  /** El preview comparte owner con las vistas y nunca se superpone al Quick View. */
  function openCartPreview() {
    if (selectedProduct) return
    onCartClick()
  }

  /** Reinicia la paginación únicamente cuando cambia el query del catálogo. */
  const handleSearchChange = useCallback((query: string) => {
    if (query === catalogQuery) return
    setCatalogQuery(query)
    setCurrentPage(1)
  }, [catalogQuery, setCurrentPage])

  /** Aplica filtros y vuelve a la primera página para consultar resultados válidos. */
  function handleFiltersChange(nextFilters: CatalogFiltersState) {
    setFilters(nextFilters)
    setCurrentPage(1)
  }

  /** Cambia de página y desplaza el viewport al inicio de resultados tras el render. */
  function handleDirectionalPageChange(page: number) {
    setCurrentPage(page)

    requestAnimationFrame(() => {
      if (resultsStartRef.current) {
        scrollToElement(resultsStartRef.current)
      }
    })
  }

  return (
    <div className={styles.page} hidden={!active} inert={!active}>
      {!selectedProduct && feedback?.source === 'catalog' ? <CartFeedbackToast productName={feedback.productName} /> : null}
      <Header onCartClick={openCartPreview} />

      <main>
        <CatalogHero />

        <section className={styles.catalog} id="catalog" aria-labelledby="catalog-title">
          <div className={styles.container}>
            <header className={styles.introduction}>
              <div>
                <p className={styles.eyebrow}>Tecnología para cada propósito</p>
                <h2 id="catalog-title" tabIndex={-1} data-app-heading>Catálogo de productos</h2>
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
                  onProductAdded={(product) => onProductAdded(product, 'catalog')}
                  addedProductId={feedback?.productId}
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

      {selectedProduct && active && !isCartPreviewOpen ? (
        <ProductQuickView
          product={selectedProduct}
          onProductAdded={(product) => onProductAdded(product, 'quick-view')}
          addedProductId={feedback?.productId}
          feedbackProductName={feedback?.source === 'quick-view' ? feedback.productName : undefined}
          onClose={() => setSelectedProduct(null)}
        />
      ) : null}
    </div>
  )
}

export default ProductListingPage
