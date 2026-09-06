import { useEffect, useRef } from 'react'

import styles from '../../styles/catalog/CatalogToolbar.module.css'
import type { Product } from '../../data/products'
import { useProductSearch } from '../../hooks/useProductSearch'
import SearchBox from './SearchBox'

function FilterIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="M3 5h14M5.5 10h9M8 15h4" />
    </svg>
  )
}

function GridIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <rect x="3" y="3" width="5" height="5" rx="1" />
      <rect x="12" y="3" width="5" height="5" rx="1" />
      <rect x="3" y="12" width="5" height="5" rx="1" />
      <rect x="12" y="12" width="5" height="5" rx="1" />
    </svg>
  )
}

interface CatalogToolbarProps {
  productCount: number
  onSearchChange: () => void
  onProductSelect: (product: Product) => void
}

function CatalogToolbar({
  productCount,
  onSearchChange,
  onProductSelect,
}: CatalogToolbarProps) {
  const { query, setQuery, results, isLoading, error } = useProductSearch()

  const previousQueryRef = useRef(query)
  useEffect(() => {
    if (previousQueryRef.current !== query) {
      previousQueryRef.current = query
      onSearchChange()
    }
  }, [query, onSearchChange])

  return (
    <div className={styles.controlsBlock}>
      <div className={styles.searchGroup}>
        <SearchBox
          query={query}
          onQueryChange={setQuery}
          results={results}
          isLoading={isLoading}
          error={error}
          onSelectResult={onProductSelect}
        />
      </div>

      <div className={styles.toolbar} aria-label="Controles visuales del catálogo">
        <div className={styles.controls}>
          <button type="button" disabled title="Disponible próximamente">
            <FilterIcon />
            Filtros
          </button>
          <button type="button" disabled title="Disponible próximamente">
            <GridIcon />
            Categorías
          </button>
          <label className={styles.sort}>
            <span>Ordenar por</span>
            <select disabled aria-label="Ordenar productos">
              <option>Más relevantes</option>
            </select>
          </label>
        </div>

        <p className={styles.status}>
          <span aria-hidden="true" />
          {productCount} productos demo
        </p>
      </div>
    </div>
  )
}

export default CatalogToolbar
