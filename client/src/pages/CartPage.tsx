import { useState } from 'react'

import CartFeedbackToast from '../components/catalog/CartFeedbackToast'
import CartSection from '../components/cart/CartSection'
import ProductQuickView from '../components/catalog/ProductQuickView'
import Footer from '../components/layout/Footer'
import Header from '../components/layout/Header'
import { useCart } from '../hooks/useCart'
import styles from '../styles/pages/ProductListingPage.module.css'
import type { Product } from '../types/product'

interface CartPageProps {
  onCartClick: () => void
  onContinueShopping: () => void
}

function CartPage({ onCartClick, onContinueShopping }: CartPageProps) {
  const { productDetailsById } = useCart()
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null)

  function handleProductSelect(productId: string) {
    const product = productDetailsById[productId]
    if (product) setSelectedProduct(product)
  }

  return (
    <div className={styles.page}>
      <CartFeedbackToast placement="catalog" />
      <Header
        cartView
        onCartClick={onCartClick}
        onCatalogClick={onContinueShopping}
      />
        <main>
          <CartSection
            onContinueShopping={onContinueShopping}
            onProductSelect={handleProductSelect}
          />
        </main>
        {selectedProduct ? (
          <ProductQuickView
            product={selectedProduct}
            onClose={() => setSelectedProduct(null)}
            allowAddToCart={false}
          />
        ) : null}
        <Footer />
    </div>
  )
}

export default CartPage
