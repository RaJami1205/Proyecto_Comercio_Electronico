/** Presenta productos vistos desde IDs por identidad y datos actuales del ProductService. */
import { useEffect, useState } from 'react'
import type { Product } from '../../types/product'
import { getProductsByIds } from '../../services/productApi'
import { analyticsStorage, getRecentlyViewedProductIds, refreshAnalyticsState } from '../../services/analytics'
import styles from '../../styles/catalog/RecentlyViewedProducts.module.css'

interface RecentlyViewedProductsProps {
  userId?: string
  onProductSelect: (product: Product) => void
}

const priceFormatter = new Intl.NumberFormat('es-CR', { style: 'currency', currency: 'CRC', maximumFractionDigits: 0 })

/** Carga solo las tarjetas actuales de los IDs guardados y descarta respuestas obsoletas. */
function RecentlyViewedProducts({ userId, onProductSelect }: RecentlyViewedProductsProps) {
  const [snapshot, setSnapshot] = useState<{ owner?: string; products: Product[] }>({ owner: userId, products: [] })

  useEffect(() => {
    let cancelled = false
    let requestVersion = 0
    const refresh = () => {
      const version = ++requestVersion
      const ids = getRecentlyViewedProductIds(userId)
      if (ids.length === 0) { setSnapshot({ owner: userId, products: [] }); return }
      void getProductsByIds(ids).then((currentProducts) => {
        if (!cancelled && version === requestVersion) setSnapshot({ owner: userId, products: currentProducts })
      }).catch(() => {
        if (!cancelled && version === requestVersion) setSnapshot({ owner: userId, products: [] })
      })
    }
    refresh()
    const handleStorage = (event: StorageEvent) => {
      if (event.key === null || event.key?.startsWith(analyticsStorage.keyPrefix)) {
        refreshAnalyticsState(userId)
        refresh()
      }
    }
    window.addEventListener(analyticsStorage.changedEvent, refresh)
    window.addEventListener('storage', handleStorage)
    return () => {
      cancelled = true
      window.removeEventListener(analyticsStorage.changedEvent, refresh)
      window.removeEventListener('storage', handleStorage)
    }
  }, [userId])

  const products = snapshot.owner === userId ? snapshot.products : []
  if (products.length === 0) return null
  return (
    <section className={styles.section} aria-labelledby="recently-viewed-title">
      <div className={styles.heading}>
        <div>
          <p className={styles.eyebrow}>Tu historial</p>
          <h2 id="recently-viewed-title">Vistos recientemente</h2>
        </div>
      </div>
      <div className={styles.grid}>
        {products.map((product) => (
          <button key={product.id} className={styles.card} type="button" onClick={() => onProductSelect(product)}>
            <img src={product.image} alt="" loading="lazy" />
            <span className={styles.name}>{product.name}</span>
            <span className={styles.price}>{priceFormatter.format(product.price)}</span>
          </button>
        ))}
      </div>
    </section>
  )
}

export default RecentlyViewedProducts
