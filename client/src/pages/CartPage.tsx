/** Compone la vista del carrito reutilizando Header, Footer y CartSection. */
import CartFeedbackToast from '../components/catalog/CartFeedbackToast'
import { useState } from 'react'
import CartSection from '../components/cart/CartSection'
import ProductQuickView from '../components/catalog/ProductQuickView'
import type { Product } from '../types/product'
import Footer from '../components/layout/Footer'
import Header from '../components/layout/Header'
import styles from '../styles/pages/ProductListingPage.module.css'
import type { PolicyView } from '../utils/appNavigation'

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
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null)
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
            onProductSelect={setSelectedProduct}
          />
        </main>
        <Footer onCatalogClick={onContinueShopping} onPolicyNavigate={onPolicyNavigate} />
      {selectedProduct ? <ProductQuickView product={selectedProduct} onProductAdded={() => undefined} showAddToCart={false} onClose={() => setSelectedProduct(null)} /> : null}
    </div>
  )
}

export default CartPage
