import CartFeedbackToast from '../components/catalog/CartFeedbackToast'
import CartSection from '../components/cart/CartSection'
import Footer from '../components/layout/Footer'
import Header from '../components/layout/Header'
import styles from '../styles/pages/ProductListingPage.module.css'

interface CartPageProps {
  feedbackProductName?: string
  onCartClick: () => void
  onContinueShopping: () => void
}

function CartPage({ onCartClick, onContinueShopping, feedbackProductName }: CartPageProps) {
  return (
    <div className={styles.page}>
      {feedbackProductName ? <CartFeedbackToast productName={feedbackProductName} /> : null}
      <Header
        cartView
        onCartClick={onCartClick}
        onCatalogClick={onContinueShopping}
      />
        <main>
          <CartSection
            onContinueShopping={onContinueShopping}
          />
        </main>
        <Footer />
    </div>
  )
}

export default CartPage
