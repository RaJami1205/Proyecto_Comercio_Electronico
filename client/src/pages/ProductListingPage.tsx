/** Coordina catálogo y Cart por History API, conservando montado el catálogo oculto. */
import { useCallback, useEffect, useRef, useState } from 'react'

import CartFeedbackToast from '../components/catalog/CartFeedbackToast'
import CatalogFilters from '../components/catalog/CatalogFilters'
import CatalogHero from '../components/catalog/CatalogHero'
import CatalogToolbar, { type ActivePanel } from '../components/catalog/CatalogToolbar'
import Pagination from '../components/catalog/Pagination'
import ProductGrid from '../components/catalog/ProductGrid'
import ProductQuickView from '../components/catalog/ProductQuickView'
import CartPreviewDrawer from '../components/cart/CartPreviewDrawer'
import Footer from '../components/layout/Footer'
import Header from '../components/layout/Header'
import CartPage from './CartPage'
import type { Product } from '../types/product'
import { useCatalogPagination } from '../hooks/useCatalogPagination'
import { useProductCatalog } from '../hooks/useProductCatalog'
import type { CatalogFilters as CatalogFiltersState } from '../services/productApi'
import styles from '../styles/pages/ProductListingPage.module.css'
import { scrollToElement } from '../utils/scrollToAnchor'

interface CartFeedback {
  productId: string
  productName: string
  source: 'catalog' | 'quick-view'
}

const EMPTY_FILTERS: CatalogFiltersState = {
  categories: [],
  brands: [],
  specifications: {},
  minPrice: '',
  maxPrice: '',
}

/** Posee filtros, query, selección de Quick View y feedback temporal de presentación. */
function ProductListingPage() {
  const [isCartPage, setIsCartPage] = useState(() => window.location.hash === '#cart-page')
  const [isCartPreviewOpen, setIsCartPreviewOpen] = useState(false)
  const { currentPage, pageSize, setCurrentPage } = useCatalogPagination()
  const [filters, setFilters] = useState<CatalogFiltersState>(EMPTY_FILTERS)
  const [catalogQuery, setCatalogQuery] = useState('')
  
  // Un único panel activo evita desplegar grupos de filtros simultáneamente.
  const [activePanel, setActivePanel] = useState<ActivePanel>(null)
  
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null)
  // El feedback es presentación temporal; no forma parte del dominio del Cart.
  const [feedback, setFeedback] = useState<CartFeedback | null>(null)
  const feedbackTimeoutRef = useRef<number | null>(null)

  useEffect(() => () => {
    if (feedbackTimeoutRef.current !== null) window.clearTimeout(feedbackTimeoutRef.current)
  }, [])

  /** Reemplaza el feedback anterior y reinicia su timer para mantener un solo aviso. */
  function showCartFeedback(product: Pick<Product, 'id' | 'name'>, source: CartFeedback['source']) {
    if (feedbackTimeoutRef.current !== null) window.clearTimeout(feedbackTimeoutRef.current)
    setFeedback({ productId: product.id, productName: product.name, source })
    feedbackTimeoutRef.current = window.setTimeout(() => {
      setFeedback(null)
      feedbackTimeoutRef.current = null
    }, 2500)
  }

  const resultsStartRef = useRef<HTMLDivElement>(null)

  const { products, totalPages, nbHits, facets, isLoading, error } =
    useProductCatalog(currentPage, pageSize, filters, catalogQuery)

  useEffect(() => {
    /** Sincroniza la vista visible con los cambios de hash y el historial del navegador. */
    function syncPageWithLocation() {
      const shouldShowCart = window.location.hash === '#cart-page'
      setIsCartPreviewOpen(false)
      setIsCartPage(shouldShowCart)

      if (!shouldShowCart) {
        window.scrollTo({ top: 0, behavior: 'auto' })
      }
    }

    window.addEventListener('popstate', syncPageWithLocation)
    window.addEventListener('hashchange', syncPageWithLocation)

    return () => {
      window.removeEventListener('popstate', syncPageWithLocation)
      window.removeEventListener('hashchange', syncPageWithLocation)
    }
  }, [])

  /** Abre la vista Cart sin desmontar el estado de búsqueda del catálogo. */
  function navigateToCart() {
    setIsCartPreviewOpen(false)
    if (window.location.hash !== '#cart-page') {
      window.history.pushState({ view: 'cart' }, '', '#cart-page')
    }
    setIsCartPage(true)
    window.scrollTo({ top: 0, behavior: 'auto' })
  }

  /** Regresa al catálogo conservando su estado y retirando el hash del Cart. */
  function navigateToCatalog() {
    setIsCartPreviewOpen(false)
    window.history.pushState(
      { view: 'catalog' },
      '',
      `${window.location.pathname}${window.location.search}`,
    )
    setIsCartPage(false)
    window.scrollTo({ top: 0, behavior: 'auto' })
  }

  /** El preview comparte owner con las vistas y nunca se superpone al Quick View. */
  function openCartPreview() {
    if (selectedProduct && !isCartPage) return
    setIsCartPreviewOpen(true)
  }

  function continueShoppingFromPreview() {
    if (isCartPage) navigateToCatalog()
    else setIsCartPreviewOpen(false)
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
    <>
    {/* Mantener mounted conserva búsqueda, historial y filtros; hidden/inert impiden interacción. */}
    <div className={styles.page} hidden={isCartPage} inert={isCartPage}>
      {!selectedProduct && feedback?.source === 'catalog' ? <CartFeedbackToast productName={feedback.productName} /> : null}
      <Header onCartClick={openCartPreview} />

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
                  onProductAdded={(product) => showCartFeedback(product, 'catalog')}
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

      {selectedProduct && !isCartPage && !isCartPreviewOpen ? (
        <ProductQuickView
          product={selectedProduct}
          onProductAdded={(product) => showCartFeedback(product, 'quick-view')}
          addedProductId={feedback?.productId}
          feedbackProductName={feedback?.source === 'quick-view' ? feedback.productName : undefined}
          onClose={() => setSelectedProduct(null)}
        />
      ) : null}
    </div>
    {isCartPage ? (
      <CartPage
        onCartClick={openCartPreview}
        onContinueShopping={navigateToCatalog}
        feedbackProductName={feedback?.source === 'catalog' ? feedback.productName : undefined}
      />
    ) : null}
    {isCartPreviewOpen ? (
      <CartPreviewDrawer
        onClose={() => setIsCartPreviewOpen(false)}
        onViewCart={navigateToCart}
        onContinueShopping={continueShoppingFromPreview}
      />
    ) : null}
    </>
  )
}

export default ProductListingPage
