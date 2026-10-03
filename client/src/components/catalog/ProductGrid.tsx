/** Organiza los resultados paginados y propaga las interacciones hacia sus cards. */
import type { Product } from '../../types/product'
import styles from '../../styles/catalog/ProductGrid.module.css'
import ProductCard from './ProductCard'

interface ProductGridProps {
  onProductAdded: (product: Pick<Product, 'id' | 'name'>) => void
  addedProductId?: string
  products: Product[]
  currentPage: number
  totalPages: number
  onProductSelect: (product: Product) => void
}

/** Renderiza las cards con callbacks de selección y feedback compartidos. */
function ProductGrid({
  onProductAdded,
  addedProductId,
  products,
  currentPage,
  totalPages,
  onProductSelect,
}: ProductGridProps) {
  return (
    <section className={styles.section} aria-labelledby="product-results-title">
      <h3 className={styles.visuallyHidden} id="product-results-title">
        Productos demo, página {currentPage} de {totalPages}
      </h3>

      <div className={styles.grid}>
        {products.map((product) => (
          <ProductCard
            key={product.id}
            product={product}
            onProductAdded={onProductAdded}
            addedProductId={addedProductId}
            onProductSelect={onProductSelect}
          />
        ))}
      </div>
    </section>
  )
}

export default ProductGrid
