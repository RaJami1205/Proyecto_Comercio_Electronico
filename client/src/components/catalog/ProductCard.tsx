/** Integra cada producto del catálogo con Quick View y la API pública del Cart. */
import type { Product } from '../../types/product'
import { useCart } from '../../hooks/useCart'
import styles from '../../styles/catalog/ProductCard.module.css'

interface ProductCardProps {
  product: Product
  onProductAdded: (product: Pick<Product, 'id' | 'name'>) => void
  addedProductId?: string
  onProductSelect: (product: Product) => void
}

const priceFormatter = new Intl.NumberFormat('es-CR', {
  style: 'currency',
  currency: 'CRC',
  maximumFractionDigits: 0,
})

function CartIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3 4h2l2.2 10.1a2 2 0 0 0 2 1.6h7.9a2 2 0 0 0 1.9-1.4L21 8H7" />
      <circle cx="10" cy="20" r="1.3" />
      <circle cx="18" cy="20" r="1.3" />
    </svg>
  )
}

/** Presenta disponibilidad y precio, delegando detalle y feedback al owner. */
function ProductCard({ product, onProductSelect, onProductAdded, addedProductId }: ProductCardProps) {
  const { addItem } = useCart()
  const availabilityLabel = product.inStock ? 'En stock' : 'Agotado'

  /** Envía el snapshot mínimo al Cart; quantity y duplicados quedan a cargo del reducer. */
  function handleAddToCart() {
    addItem({
      productId: product.id,
      name: product.name,
      price: product.price,
      image: product.image,
    })
    onProductAdded({ id: product.id, name: product.name })
  }

  return (
    <article className={styles.card}>
      <button
        className={styles.detailsButton}
        type="button"
        aria-label={`Ver detalles de ${product.name}`}
        onClick={() => onProductSelect(product)}
      />

      <div className={styles.imageArea}>
        <img src={product.image} alt={product.name} loading="lazy" />
      </div>

      <div className={styles.body}>
        <h3 title={product.name}>{product.name}</h3>

        <div className={styles.purchaseRow}>
          <p className={styles.price}>{priceFormatter.format(product.price)}</p>
          <button
            className={`${styles.cartButton} ${
              addedProductId === product.id ? styles.cartButtonAdded : ''
            }`}
            type="button"
            disabled={!product.inStock}
            aria-label={
              product.inStock
                ? `Agregar ${product.name} al carrito`
                : `${product.name} está agotado`
            }
            title={product.inStock ? `Agregar ${product.name} al carrito` : 'Producto agotado'}
            onClick={handleAddToCart}
          >
            <CartIcon />
          </button>
        </div>

        <p
          className={`${styles.stock} ${
            product.inStock ? styles.inStock : styles.outOfStock
          }`}
        >
          <span aria-hidden="true" />
          {availabilityLabel}
        </p>
      </div>
    </article>
  )
}

export default ProductCard
