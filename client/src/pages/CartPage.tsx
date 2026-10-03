/** Compone la vista del carrito reutilizando Header, Footer y CartSection. */
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

/** Presenta el Cart y delega la navegación y el feedback temporal a la página owner. */
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
