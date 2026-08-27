import type { Product } from '../../data/products'
import styles from '../../styles/catalog/ProductGrid.module.css'
import ProductCard from './ProductCard'

interface ProductGridProps {
  products: Product[]
  currentPage: number
  totalPages: number
}

function ProductGrid({ products, currentPage, totalPages }: ProductGridProps) {
  return (
    <section className={styles.section} aria-labelledby="product-results-title">
      <h3 className={styles.visuallyHidden} id="product-results-title">
        Productos demo, página {currentPage} de {totalPages}
      </h3>

      <div className={styles.grid}>
        {products.map((product) => (
          <ProductCard key={product.id} product={product} />
        ))}
      </div>
    </section>
  )
}

export default ProductGrid
