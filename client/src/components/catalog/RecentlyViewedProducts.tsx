/** Presenta productos vistos desde IDs por identidad y datos actuales del ProductService. */
import { useEffect, useRef, useState } from 'react'
import type { Product } from '../../types/product'
import { getProductsByIds } from '../../services/productApi'
import { analyticsStorage, getRecentlyViewedProductIds, refreshAnalyticsState } from '../../services/analytics'
import styles from '../../styles/catalog/RecentlyViewedProducts.module.css'

interface RecentlyViewedProductsProps {
  userId?: string
  onProductSelect: (product: Product) => void
}

const priceFormatter = new Intl.NumberFormat('es-CR', { style: 'currency', currency: 'CRC', maximumFractionDigits: 0 })

/** Asocia los productos resueltos con los IDs solicitados y su owner durante la carga. */
interface HistorySnapshot {
  owner?: string
  ids: string[]
  products: Product[]
  status: 'loading' | 'empty' | 'error' | 'success'
}

/** Carga solo las tarjetas actuales de los IDs guardados y descarta respuestas obsoletas. */
function RecentlyViewedProducts({ userId, onProductSelect }: RecentlyViewedProductsProps) {
  const [snapshot, setSnapshot] = useState<HistorySnapshot>({ owner: userId, ids: [], products: [], status: 'empty' })
  const requestRefresh = useRef<(() => void) | null>(null)

  useEffect(() => {
    let cancelled = false
    let requestVersion = 0
    let requestedIds: string[] | undefined
    let inFlight = false
    /** Resuelve el historial cuando cambia el orden de IDs. Un refresh explícito también actualiza un historial idéntico, salvo que ya esté en curso. */
    const refresh = (force = false) => {
      if (cancelled) return
      const ids = getRecentlyViewedProductIds(userId)
      const unchanged = requestedIds !== undefined && ids.length === requestedIds.length && ids.every((id, index) => id === requestedIds?.[index])
      if ((!force && unchanged) || (force && unchanged && inFlight)) return
      requestedIds = ids
      const version = ++requestVersion
      if (ids.length === 0) {
        inFlight = false
        setSnapshot({ owner: userId, ids, products: [], status: 'empty' })
        return
      }
      inFlight = true
      // Solo se conservan productos válidos del mismo owner que aún pertenecen al historial.
      setSnapshot(current => ({ owner: userId, ids, status: 'loading', products: current.owner === userId
        ? ids.flatMap(id => current.products.filter(product => product.id === id)) : [] }))
      void getProductsByIds(ids).then((currentProducts) => {
        if (!cancelled && version === requestVersion) {
          inFlight = false
          setSnapshot({ owner: userId, ids, products: currentProducts, status: currentProducts.length ? 'success' : 'empty' })
        }
      }).catch(() => {
        if (!cancelled && version === requestVersion) {
          inFlight = false
          setSnapshot(current => ({ ...current, status: 'error' }))
        }
      })
    }
    requestRefresh.current = () => refresh(true)
    refresh()
    const scopeKey = analyticsStorage.keyPrefix + (userId === undefined ? 'anonymous' : `user:${encodeURIComponent(userId)}`)
    /** Reconcilia el scope activo tras una escritura v2 en otra pestaña o un borrado del storage. */
    const handleStorage = (event: StorageEvent) => {
      if (event.key === null || event.key === scopeKey) {
        refreshAnalyticsState(userId)
        refresh()
      }
    }
    /** Revisa los IDs ante actividad local para actualizar las tarjetas cuando cambie el historial. */
    const handleAnalytics = () => refresh()
    window.addEventListener(analyticsStorage.changedEvent, handleAnalytics)
    window.addEventListener('storage', handleStorage)
    return () => {
      cancelled = true
      requestRefresh.current = null
      window.removeEventListener(analyticsStorage.changedEvent, handleAnalytics)
      window.removeEventListener('storage', handleStorage)
    }
  }, [userId])

  if (snapshot.owner !== userId || snapshot.ids.length === 0) return null
  const { products, status } = snapshot
  return (
    <section className={styles.section} aria-labelledby="recently-viewed-title" aria-busy={status === 'loading'}>
      <div className={styles.heading}>
        <div>
          <p className={styles.eyebrow}>Tu historial</p>
          <h2 id="recently-viewed-title">Vistos recientemente</h2>
        </div>
        <button type="button" className={styles.refresh} disabled={status === 'loading'} onClick={() => requestRefresh.current?.()}>
          {status === 'error' ? 'Reintentar' : 'Actualizar'}
        </button>
      </div>
      {status === 'loading' ? <p className={styles.status} role="status">Actualizando tu historial…</p> : null}
      {status === 'error' ? <p className={styles.error} role="alert">
        No pudimos actualizar tus productos vistos. Intenta de nuevo.
        {products.length ? ' Mostramos los datos de la última consulta.' : ''}
      </p> : null}
      {status === 'empty' ? <p className={styles.status} role="status">Los productos de tu historial ya no están disponibles.</p> : null}
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
