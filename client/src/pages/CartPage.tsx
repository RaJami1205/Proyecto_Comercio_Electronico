/** Compone la vista del carrito reutilizando Header, Footer y CartSection. */
import CartFeedbackToast from '../components/catalog/CartFeedbackToast'
import { useLayoutEffect, useRef, useState } from 'react'
import CartSection from '../components/cart/CartSection'
import ProductQuickView from '../components/catalog/ProductQuickView'
import type { Product } from '../types/product'
import Footer from '../components/layout/Footer'
import Header from '../components/layout/Header'
import styles from '../styles/pages/ProductListingPage.module.css'
import type { PolicyView } from '../utils/appNavigation'
import { useSession } from '../hooks/useSession'
import { trackEvent } from '../services/analytics'

interface CartPageProps {
  onPolicyNavigate: (view: PolicyView) => void
  feedbackProductName?: string
  onCartClick: () => void
  onContinueShopping: (hash?: '#top' | '#catalog') => void
  onCheckoutRequested: () => void
  navigationNotice?: string
}

/** Presenta el Cart y delega la navegación y el feedback temporal a la página owner. */
function CartPage({ onCartClick, onContinueShopping, onCheckoutRequested, feedbackProductName, navigationNotice, onPolicyNavigate }: CartPageProps) {
  const { user, epoch } = useSession()
  const userId = user?.id
  const [selection, setSelection] = useState<{ product: Product; epoch: number; userId: string | undefined } | null>(null)
  const currentSession = useRef<{ epoch: number; userId: string | undefined } | null>(null)
  const selectedProduct = selection?.epoch === epoch && selection.userId === userId ? selection.product : null

  useLayoutEffect(() => {
    currentSession.current = { epoch, userId }
    return () => { currentSession.current = null }
  }, [epoch, userId])

  /** Registra solo la apertura solicitada en la Session vigente; un callback anterior no conserva su scope. */
  function openProduct(product: Product) {
    if (currentSession.current?.epoch !== epoch || currentSession.current.userId !== userId) return
    trackEvent({ type: 'PRODUCT_VIEWED', occurredAt: new Date().toISOString(), metadata: { productId: product.id } }, userId)
    setSelection({ product, epoch, userId })
  }
  return (
    <div className={styles.page}>
      {feedbackProductName ? <CartFeedbackToast productName={feedbackProductName} /> : null}
      <Header
        cartView
        onCartClick={onCartClick}
        onCatalogClick={onContinueShopping}
      />
        <main>
          {navigationNotice ? <p className={styles.container} role="status">{navigationNotice}</p> : null}
          <CartSection
            onContinueShopping={onContinueShopping}
            onCheckoutRequested={onCheckoutRequested}
            onProductSelect={openProduct}
          />
        </main>
        <Footer onCatalogClick={onContinueShopping} onPolicyNavigate={onPolicyNavigate} />
      {selectedProduct ? <ProductQuickView product={selectedProduct} onProductAdded={() => undefined} showAddToCart={false} onClose={() => setSelection(null)} /> : null}
    </div>
  )
}

export default CartPage
