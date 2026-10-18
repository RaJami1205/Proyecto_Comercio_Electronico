/** Compone la vista del carrito reutilizando Header, Footer y CartSection. */
import CartFeedbackToast from '../components/catalog/CartFeedbackToast'
import CartSection from '../components/cart/CartSection'
import Footer from '../components/layout/Footer'
import Header from '../components/layout/Header'
import styles from '../styles/pages/ProductListingPage.module.css'

interface CartPageProps {
  feedbackProductName?: string
  onCartClick: () => void
  onContinueShopping: (hash?: '#top' | '#catalog') => void
  onCheckoutRequested: () => void
  navigationNotice?: string
}

/** Presenta el Cart y delega la navegación y el feedback temporal a la página owner. */
function CartPage({ onCartClick, onContinueShopping, onCheckoutRequested, feedbackProductName, navigationNotice }: CartPageProps) {
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
          />
        </main>
        <Footer onCatalogClick={onContinueShopping} />
    </div>
  )
}

export default CartPage
