import type { Product } from '../../data/products'
import styles from '../../styles/catalog/ProductGrid.module.css'
import ProductCard from './ProductCard'

// Define las propiedades esperadas por la cuadrícula de productos,
// incluyendo el arreglo de productos a mostrar, estado de paginación
// y la función callback al seleccionar un producto
interface ProductGridProps {
  products: Product[]
  currentPage: number
  totalPages: number
  onProductSelect: (product: Product) => void
}

// Renderiza una cuadrícula estructurada de tarjetas de productos
// Se encarga de iterar sobre el arreglo de resultados y pasar
// los datos correspondientes a cada componente ProductCard individual
function ProductGrid({
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
            onProductSelect={onProductSelect}
          />
        ))}
      </div>
    </section>
  )
}

export default ProductGrid
