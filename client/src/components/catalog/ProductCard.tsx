import type { Product } from '../../data/products'
import styles from '../../styles/catalog/ProductCard.module.css'

// Define las propiedades esperadas por la tarjeta de producto,
// incluyendo los datos del producto a mostrar y la función
// a ejecutar cuando el usuario selecciona la tarjeta
interface ProductCardProps {
  product: Product
  onProductSelect: (product: Product) => void
}

// Instancia un formateador de moneda para convertir
// valores numéricos a Colones Costarricenses (CRC)
// sin mostrar decimales, según el requerimiento del proyecto
const priceFormatter = new Intl.NumberFormat('es-CR', {
  style: 'currency',
  currency: 'CRC',
  maximumFractionDigits: 0,
})

// Dibuja el icono vectorial de un carrito de compras
// utilizado en el botón de acción principal de la tarjeta
function CartIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3 4h2l2.2 10.1a2 2 0 0 0 2 1.6h7.9a2 2 0 0 0 1.9-1.4L21 8H7" />
      <circle cx="10" cy="20" r="1.3" />
      <circle cx="18" cy="20" r="1.3" />
    </svg>
  )
}

// Renderiza la tarjeta individual de un producto del catálogo
// Muestra su imagen, precio formateado, estado de inventario
// y maneja la interacción para ver detalles o simular la compra
function ProductCard({ product, onProductSelect }: ProductCardProps) {
  const availabilityLabel = product.inStock ? 'En stock' : 'Agotado'

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
            className={styles.cartButton}
            type="button"
            disabled={!product.inStock}
            aria-label={
              product.inStock
                ? `Agregar ${product.name} al carrito (disponible próximamente)`
                : `${product.name} está agotado`
            }
            title={product.inStock ? 'Carrito disponible próximamente' : 'Producto agotado'}
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
