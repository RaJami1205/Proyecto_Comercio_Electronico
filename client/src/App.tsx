import { useCallback, useEffect, useRef, useState } from 'react'
import ProductListingPage, { type CartFeedback } from './pages/ProductListingPage'
import CartPage from './pages/CartPage'
import CheckoutPage from './pages/CheckoutPage'
import CartPreviewDrawer from './components/cart/CartPreviewDrawer'
import { useCart } from './hooks/useCart'
import type { Product } from './types/product'

type AppView = 'catalog' | 'cart' | 'checkout'
interface NavigationState {
  view: AppView
  emptyCartNotice: boolean
}

function viewFromLocation(): AppView {
  if (window.location.hash === '#checkout') return 'checkout'
  return window.location.hash === '#cart-page' ? 'cart' : 'catalog'
}

function App() {
  const { items } = useCart()
  const [navigation, setNavigation] = useState<NavigationState>(() => ({
    view: viewFromLocation(), emptyCartNotice: false,
  }))
  const initialNavigationRef = useRef(navigation)
  const [isCartPreviewOpen, setIsCartPreviewOpen] = useState(false)
  const [feedback, setFeedback] = useState<CartFeedback | null>(null)
  const feedbackTimeoutRef = useRef<number | null>(null)
  const restoreDrawerFocusRef = useRef(true)
  const shouldRestoreDrawerFocus = useCallback(() => restoreDrawerFocusRef.current, [])

  // Ajuste antes del commit: nunca se monta Checkout con un Cart vacío.
  if (navigation.view === 'checkout' && items.length === 0) {
    setNavigation({ view: 'cart', emptyCartNotice: true })
    if (isCartPreviewOpen) setIsCartPreviewOpen(false)
  }
  const { view, emptyCartNotice } = navigation

  useEffect(() => {
    function syncLocation() {
      restoreDrawerFocusRef.current = false
      setIsCartPreviewOpen(false)
      setNavigation({ view: viewFromLocation(), emptyCartNotice: false })
    }
    window.addEventListener('popstate', syncLocation)
    window.addEventListener('hashchange', syncLocation)
    return () => {
      window.removeEventListener('popstate', syncLocation)
      window.removeEventListener('hashchange', syncLocation)
    }
  }, [])

  useEffect(() => {
    if (emptyCartNotice && window.location.hash === '#checkout') {
      window.history.replaceState({ view: 'cart' }, '', '#cart-page')
    }
    const frame = requestAnimationFrame(() => {
      const hash = window.location.hash
      const anchor = view === 'catalog' && hash ? document.getElementById(hash.slice(1)) : null
      if (anchor) anchor.scrollIntoView({ behavior: 'auto' })
      else window.scrollTo({ top: 0, behavior: 'auto' })
      // El catálogo inicial no necesita anunciar un cambio de vista.
      if (view === 'catalog' && navigation === initialNavigationRef.current) return
      const heading = Array.from(document.querySelectorAll<HTMLElement>('[data-app-heading]'))
        .find((element) => !element.closest('[hidden], [inert]') && element.getClientRects().length > 0)
      heading?.focus({ preventScroll: true })
    })
    return () => cancelAnimationFrame(frame)
  }, [navigation, view, emptyCartNotice])

  useEffect(() => () => {
    if (feedbackTimeoutRef.current !== null) clearTimeout(feedbackTimeoutRef.current)
  }, [])

  function showCartFeedback(product: Pick<Product, 'id' | 'name'>, source: CartFeedback['source']) {
    if (feedbackTimeoutRef.current !== null) clearTimeout(feedbackTimeoutRef.current)
    setFeedback({ productId: product.id, productName: product.name, source })
    feedbackTimeoutRef.current = window.setTimeout(() => {
      setFeedback(null)
      feedbackTimeoutRef.current = null
    }, 2500)
  }

  function navigate(requestedView: AppView, catalogHash: '' | '#top' | '#catalog' = '') {
    restoreDrawerFocusRef.current = false
    setIsCartPreviewOpen(false)
    const denied = requestedView === 'checkout' && items.length === 0
    const nextView = denied ? 'cart' : requestedView
    const destination = nextView === 'catalog'
      ? `${window.location.pathname}${window.location.search}${catalogHash}`
      : nextView === 'cart' ? '#cart-page' : '#checkout'
    if (viewFromLocation() !== nextView || (nextView === 'catalog' && window.location.hash !== catalogHash)) {
      if (denied && window.location.hash === '#checkout') {
        window.history.replaceState({ view: nextView }, '', destination)
      } else {
        window.history.pushState({ view: nextView }, '', destination)
      }
    }
    setNavigation({ view: nextView, emptyCartNotice: denied })
  }

  function openCartPreview() {
    restoreDrawerFocusRef.current = true
    setIsCartPreviewOpen(true)
  }

  return (
    <>
      <ProductListingPage
        active={view === 'catalog'}
        isCartPreviewOpen={isCartPreviewOpen}
        onCartClick={openCartPreview}
        feedback={feedback}
        onProductAdded={showCartFeedback}
      />
      {view === 'cart' ? (
        <CartPage
          onCartClick={openCartPreview}
          onContinueShopping={(hash) => navigate('catalog', hash)}
          onCheckoutRequested={() => navigate('checkout')}
          feedbackProductName={feedback?.source === 'catalog' ? feedback.productName : undefined}
          navigationNotice={emptyCartNotice ? 'Agrega productos al carrito para continuar con la compra.' : undefined}
        />
      ) : null}
      {view === 'checkout' && items.length > 0 ? (
        <CheckoutPage
          onBackToCart={() => navigate('cart')}
          onCatalogClick={(hash) => navigate('catalog', hash)}
          onCartClick={openCartPreview}
        />
      ) : null}
      {isCartPreviewOpen ? (
        <CartPreviewDrawer
          onClose={() => setIsCartPreviewOpen(false)}
          onViewCart={() => navigate('cart')}
          onContinueShopping={() => view === 'catalog' ? setIsCartPreviewOpen(false) : navigate('catalog')}
          onCheckoutRequested={() => navigate('checkout')}
          shouldRestoreFocus={shouldRestoreDrawerFocus}
        />
      ) : null}
    </>
  )
}

export default App
