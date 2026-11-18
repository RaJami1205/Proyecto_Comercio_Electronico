/** Coordina Catalog, Cart, Checkout y políticas/FAQ mediante History API, conservando el catálogo montado. */
import { useCallback, useEffect, useRef, useState } from 'react'
import ProductListingPage, { type CartFeedback } from './pages/ProductListingPage'
import CartPage from './pages/CartPage'
import CheckoutPage from './pages/CheckoutPage'
import CartPreviewDrawer from './components/cart/CartPreviewDrawer'
import { useCart } from './hooks/useCart'
import { useSession } from './hooks/useSession'
import LoginDialog from './components/session/LoginDialog'
import type { Product } from './types/product'
import PolicyPlaceholderPage from './pages/PolicyPlaceholderPage'
import TermsPage from './pages/TermsPage'
import ReturnsPolicyPage from './pages/ReturnsPolicyPage'
import { hashForOrder, hashForView, orderIdFromHash, policyDestinations, viewFromHash, type AppView, type CatalogHash } from './utils/appNavigation'
import { ShippingPolicyPage } from './pages/ShippingPolicyPage';
import { PrivacyPolicyPage } from './pages/PrivacyPolicyPage';
import FaqPage from './pages/FaqPage'
import AnalyticsDashboardPage from './pages/AnalyticsDashboardPage'
import MyOrdersPage from './pages/MyOrdersPage'
import OrderDetailPage from './pages/OrderDetailPage'
import { trackEvent } from './services/analytics'

interface NavigationState {
  view: AppView
  emptyCartNotice: boolean
  checkoutNotice?: string
  /** Order abierta en #my-orders/<id>. */
  orderId?: string
}

const isOrdersView = (view: AppView) => view === 'orders' || view === 'order-detail'

/** Resuelve el hash mediante el mapa de destinos comerciales e informativos de appNavigation. */
function viewFromLocation(): AppView {
  return viewFromHash(window.location.hash)
}

/** Mantiene la vista activa, protege la navegación durante operaciones y conecta las páginas con el Cart compartido. */
function App() {
  const { items, hasExternalConflict } = useCart()
  const session = useSession()
  const canViewAnalytics = session.user?.role === 'ADMIN'
  // Sin Session se muestra la invitación a elegir identidad; ADMIN no usa My Orders.
  const canViewOrders = session.user?.role !== 'ADMIN'
  const { getPurchaseBlockReason, isTransactionBlocked, setCheckoutMounted, setTransactionState } = session
  const checkoutLockedRef = useRef(false)
  const [checkoutLocked, setCheckoutLocked] = useState(false)
  const [checkoutHasOrder, setCheckoutHasOrder] = useState(false)
  const [navigation, setNavigation] = useState<NavigationState>(() => ({
    view: viewFromLocation(), emptyCartNotice: false, orderId: orderIdFromHash(window.location.hash) ?? undefined,
  }))
  const initialNavigationRef = useRef(navigation)
  const [isCartPreviewOpen, setIsCartPreviewOpen] = useState(false)
  const [feedback, setFeedback] = useState<CartFeedback | null>(null)
  const feedbackTimeoutRef = useRef<number | null>(null)
  const restoreDrawerFocusRef = useRef(true)
  /** Indica si el cierre del Drawer debe devolver el foco al control que lo abrió. */
  const shouldRestoreDrawerFocus = useCallback(() => restoreDrawerFocusRef.current, [])

  // Ajuste antes del commit: nunca se monta Checkout con un Cart vacío.
  if (navigation.view === 'checkout' && !checkoutLocked && !checkoutHasOrder && !isTransactionBlocked()
    && (items.length === 0 || !session.user || session.user.role === 'ADMIN')) {
    setNavigation({ view: 'cart', emptyCartNotice: items.length === 0, checkoutNotice: session.purchaseBlockReason ?? undefined })
    if (isCartPreviewOpen) setIsCartPreviewOpen(false)
  }
  // Revocar antes del commit evita conservar contenido protegido durante cambios de Session.
  if ((navigation.view === 'analytics' && !canViewAnalytics) || (isOrdersView(navigation.view) && !canViewOrders)) {
    setNavigation({ view: 'catalog', emptyCartNotice: false })
    if (isCartPreviewOpen) setIsCartPreviewOpen(false)
  }
  const { view, emptyCartNotice } = navigation
  const [sessionEpoch, setSessionEpoch] = useState(session.epoch)
  if (sessionEpoch !== session.epoch) {
    setSessionEpoch(session.epoch)
    setFeedback(null)
    setIsCartPreviewOpen(false)
    if (navigation.checkoutNotice) setNavigation({ ...navigation, checkoutNotice: undefined })
  }
  const policyDestination = policyDestinations.find(destination => destination.view === view)
  /** La entrada a Checkout inicia el tracking una sola vez aunque React repita el efecto. */
  const previousView = useRef<AppView | null>(null)

  useEffect(() => {
    if (view === 'checkout' && previousView.current !== 'checkout') {
      trackEvent({ type: 'CHECKOUT_STARTED', occurredAt: new Date().toISOString(), metadata: {} }, session.user?.id)
    }
    previousView.current = view
  }, [view, session.user?.id])

  useEffect(() => {
    /** Sincroniza la vista con el historial o conserva Checkout cuando la navegación está bloqueada. */
    function syncLocation() {
      if (checkoutLockedRef.current || isTransactionBlocked()) {
        window.history.replaceState({ view: 'checkout' }, '', '#checkout')
        return
      }
      const requested = viewFromLocation()
      const analyticsDenied = (requested === 'analytics' && !canViewAnalytics) || (isOrdersView(requested) && !canViewOrders)
      const reason = requested === 'checkout' ? getPurchaseBlockReason() : null
      const next = analyticsDenied ? 'catalog' : reason ? 'cart' : requested
      if (analyticsDenied) window.history.replaceState({ view: 'catalog' }, '', '#catalog')
      if (reason) window.history.replaceState({ view: 'cart' }, '', '#cart-page')
      if (next !== 'checkout') { setCheckoutHasOrder(false); setTransactionState('idle') }
      setCheckoutMounted(next === 'checkout')
      restoreDrawerFocusRef.current = false
      setIsCartPreviewOpen(false)
      setNavigation({ view: next, emptyCartNotice: false, checkoutNotice: reason ?? undefined,
        orderId: next === 'order-detail' ? orderIdFromHash(window.location.hash) ?? undefined : undefined })
    }
    window.addEventListener('popstate', syncLocation)
    window.addEventListener('hashchange', syncLocation)
    /** Solicita confirmación del navegador si recargar interrumpiría una transacción activa o incierta. */
    function protectReload(event: BeforeUnloadEvent) {
      if (isTransactionBlocked()) { event.preventDefault(); event.returnValue = '' }
    }
    window.addEventListener('beforeunload', protectReload)
    return () => {
      window.removeEventListener('popstate', syncLocation)
      window.removeEventListener('hashchange', syncLocation)
      window.removeEventListener('beforeunload', protectReload)
    }
  }, [getPurchaseBlockReason, isTransactionBlocked, setCheckoutMounted, setTransactionState, canViewAnalytics, canViewOrders])

  useEffect(() => setCheckoutMounted(view === 'checkout'), [view, setCheckoutMounted])

  useEffect(() => {
    if ((!canViewAnalytics && window.location.hash === '#analytics') || (!canViewOrders && isOrdersView(viewFromLocation()))) {
      window.history.replaceState({ view: 'catalog' }, '', '#catalog')
    }
    if ((emptyCartNotice || navigation.checkoutNotice) && window.location.hash === '#checkout') {
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
  }, [navigation, view, emptyCartNotice, canViewAnalytics, canViewOrders])

  useEffect(() => () => {
    if (feedbackTimeoutRef.current !== null) clearTimeout(feedbackTimeoutRef.current)
  }, [])

  /** Publica un aviso temporal para el producto y origen indicados, sustituyendo el aviso anterior. */
  function showCartFeedback(product: Pick<Product, 'id' | 'name'>, source: CartFeedback['source']) {
    /** Los controles de compra llaman a este handler tras aceptar la adición al Cart. */
    trackEvent({ type: 'CART_ITEM_ADDED', occurredAt: new Date().toISOString(), metadata: { productId: product.id, quantity: 1 } }, session.user?.id)
    if (feedbackTimeoutRef.current !== null) clearTimeout(feedbackTimeoutRef.current)
    setFeedback({ productId: product.id, productName: product.name, source })
    feedbackTimeoutRef.current = window.setTimeout(() => {
      setFeedback(null)
      feedbackTimeoutRef.current = null
    }, 2500)
  }

  /** Solicita una vista y actualiza el historial respetando el bloqueo y la guarda de carrito vacío. */
  function navigate(requestedView: AppView, catalogHash: CatalogHash = '') {
    if (checkoutLockedRef.current || isTransactionBlocked()) return
    if (requestedView !== 'checkout') { setCheckoutHasOrder(false); setTransactionState('idle') }
    restoreDrawerFocusRef.current = false
    setIsCartPreviewOpen(false)
    const reason = requestedView === 'checkout' ? getPurchaseBlockReason() : null
    const analyticsDenied = (requestedView === 'analytics' && !canViewAnalytics) || (isOrdersView(requestedView) && !canViewOrders)
    const denied = requestedView === 'checkout' && (items.length === 0 || Boolean(reason))
    const nextView = analyticsDenied ? 'catalog' : denied ? 'cart' : requestedView
    const nextCatalogHash = analyticsDenied ? '#catalog' : catalogHash
    const destination = nextView === 'catalog'
      ? `${window.location.pathname}${window.location.search}${nextCatalogHash}`
      : hashForView(nextView)
    if (viewFromLocation() !== nextView || (nextView === 'catalog' && window.location.hash !== nextCatalogHash)) {
      if (analyticsDenied || (denied && window.location.hash === '#checkout')) {
        window.history.replaceState({ view: nextView }, '', destination)
      } else {
        window.history.pushState({ view: nextView }, '', destination)
      }
    }
    setCheckoutMounted(nextView === 'checkout')
    setNavigation({ view: nextView, emptyCartNotice: denied && !reason, checkoutNotice: reason ?? undefined })
  }

  /** Abre el detalle de una Order con un hash directo, compatible con recarga y Back/Forward. */
  function openOrder(orderId: string) {
    if (checkoutLockedRef.current || isTransactionBlocked() || !canViewOrders) return
    setCheckoutHasOrder(false)
    setTransactionState('idle')
    restoreDrawerFocusRef.current = false
    setIsCartPreviewOpen(false)
    const destination = hashForOrder(orderId)
    if (window.location.hash !== destination) window.history.pushState({ view: 'order-detail' }, '', destination)
    setCheckoutMounted(false)
    setNavigation({ view: 'order-detail', emptyCartNotice: false, orderId })
  }

  /** Abre el preview cuando la navegación está permitida y habilita el retorno del foco al trigger. */
  function openCartPreview() {
    if (checkoutLockedRef.current || isTransactionBlocked()) return
    restoreDrawerFocusRef.current = true
    setIsCartPreviewOpen(true)
  }

  return (
    <>
      {hasExternalConflict ? <div role="status" className="session-conflict">
        Se detectó un cambio de carrito en otra pestaña. Conservamos esta copia sin importar productos externos.
        <button type="button" onClick={session.resolveCartConflict} disabled={Boolean(session.transitionBlockReason)}>Revisar conflicto</button>
        {session.transitionBlockReason ? <span> {session.transitionBlockReason}</span> : null}
      </div> : null}
      <ProductListingPage
        active={view === 'catalog'}
        isCartPreviewOpen={isCartPreviewOpen}
        onCartClick={openCartPreview}
        feedback={feedback}
        onProductAdded={showCartFeedback}
        onPolicyNavigate={navigate}
      />
      {view === 'cart' ? (
        <CartPage
          onCartClick={openCartPreview}
          onContinueShopping={(hash) => navigate('catalog', hash)}
          onCheckoutRequested={() => navigate('checkout')}
          onPolicyNavigate={navigate}
          feedbackProductName={feedback?.source === 'catalog' ? feedback.productName : undefined}
          navigationNotice={navigation.checkoutNotice ?? (emptyCartNotice ? 'Agrega productos al carrito para continuar con la compra.' : undefined)}
        />
      ) : null}
      {view === 'checkout' && (items.length > 0 || checkoutLocked || checkoutHasOrder) ? (
        <CheckoutPage
          onNavigationLockChange={(busy) => { checkoutLockedRef.current = busy; setCheckoutLocked(busy) }}
          onOrderCreated={() => setCheckoutHasOrder(true)}
          onTransactionStateChange={setTransactionState}
          purchaseBlockedReason={session.purchaseBlockReason}
          getPurchaseBlockReason={getPurchaseBlockReason}
          onBackToCart={() => navigate('cart')}
          onCatalogClick={(hash) => navigate('catalog', hash)}
          onCartClick={openCartPreview}
        />
      ) : null}
      {view === 'analytics' && canViewAnalytics ? (
        <AnalyticsDashboardPage
          onCatalogClick={(hash) => navigate('catalog', hash)}
          onPolicyNavigate={navigate}
          onCartClick={openCartPreview}
        />
      ) : null}
      {view === 'orders' && canViewOrders ? (
        // La key por usuario y epoch descarta resultados y requests de la Session anterior.
        <MyOrdersPage
          key={`orders:${session.user?.id ?? 'none'}:${session.epoch}`}
          onOpenOrder={openOrder}
          onCatalogClick={(hash) => navigate('catalog', hash)}
          onPolicyNavigate={navigate}
          onCartClick={openCartPreview}
        />
      ) : null}
      {view === 'order-detail' && canViewOrders && navigation.orderId ? (
        <OrderDetailPage
          key={`order:${session.user?.id ?? 'none'}:${session.epoch}:${navigation.orderId}`}
          orderId={navigation.orderId}
          onBackToOrders={() => navigate('orders')}
          onCatalogClick={(hash) => navigate('catalog', hash)}
          onPolicyNavigate={navigate}
          onCartClick={openCartPreview}
        />
      ) : null}
      {view === 'terms' ? (
        <TermsPage
          onCatalogClick={(hash) => navigate('catalog', hash)}
          onPolicyNavigate={navigate}
          onCartClick={openCartPreview}
        />
      ) : view === 'returns-policy' ? (
        <ReturnsPolicyPage
          onCatalogClick={(hash) => navigate('catalog', hash)}
          onPolicyNavigate={navigate}
          onCartClick={openCartPreview}
        />
      ) : view === 'shipping-policy' ? (
        <ShippingPolicyPage
          onCatalogClick={(hash) => navigate('catalog', hash)}
          onPolicyNavigate={navigate}
          onCartClick={openCartPreview}
        />
        ) : view === 'privacy-policy' ? (
        <PrivacyPolicyPage
          onCatalogClick={(hash) => navigate('catalog', hash)}
          onPolicyNavigate={navigate}
          onCartClick={openCartPreview}
        />
      ) : view === 'faq' ? (
        <FaqPage
          onCatalogClick={(hash) => navigate('catalog', hash)}
          onPolicyNavigate={navigate}
          onCartClick={openCartPreview}
        />
      ) : policyDestination ? (
        <PolicyPlaceholderPage
          destination={policyDestination}
          onCatalogClick={(hash) => navigate('catalog', hash)}
          onPolicyNavigate={navigate}
          onCartClick={openCartPreview}
        />
      ) : null}
      {isCartPreviewOpen ? (
        <CartPreviewDrawer
          onClose={() => setIsCartPreviewOpen(false)}
          onViewCart={() => navigate('cart')}
          onContinueShopping={() => view === 'catalog' ? setIsCartPreviewOpen(false) : navigate('catalog')}
          onCheckoutRequested={session.purchaseBlockReason ? undefined : () => navigate('checkout')}
          checkoutNotice={session.purchaseBlockReason ?? undefined}
          shouldRestoreFocus={shouldRestoreDrawerFocus}
        />
      ) : null}
      {session.dialog ? <LoginDialog key={session.dialog} /> : null}
    </>
  )
}

export default App
