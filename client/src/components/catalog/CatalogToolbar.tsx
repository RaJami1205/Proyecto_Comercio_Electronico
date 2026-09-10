import { useEffect } from 'react'

import styles from '../../styles/catalog/CatalogToolbar.module.css'
import type { Product } from '../../data/products'
import { useProductSearch } from '../../hooks/useProductSearch'
import SearchBox from './SearchBox'

export type ActivePanel = 'filters' | 'categories' | 'price' | null

function FilterIcon() {
  return (
    <svg viewBox="0 0 20 20" width="16" height="16" fill="currentColor" aria-hidden="true">
      <path d="M3 5h14M5.5 10h9M8 15h4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  )
}

function GridIcon() {
  return (
    <svg viewBox="0 0 20 20" width="16" height="16" fill="currentColor" aria-hidden="true">
      <rect x="3" y="3" width="5" height="5" rx="1" />
      <rect x="12" y="3" width="5" height="5" rx="1" />
      <rect x="3" y="12" width="5" height="5" rx="1" />
      <rect x="12" y="12" width="5" height="5" rx="1" />
    </svg>
  )
}

function SortIcon() {
  return (
    <svg viewBox="0 0 20 20" width="16" height="16" fill="currentColor" aria-hidden="true">
      <path
        d="M6 4v12M6 4l-3 3M6 4l3 3M14 16V4M14 16l-3-3M14 16l3-3"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

interface CatalogToolbarProps {
  productCount: number
  activePanel: ActivePanel
  onTogglePanel: (panel: ActivePanel) => void
  onSearchChange: (query: string) => void
  onProductSelect: (product: Product) => void
}

function CatalogToolbar({
  productCount,
  activePanel,
  onTogglePanel,
  onSearchChange,
  onProductSelect,
}: CatalogToolbarProps) {
  const { query, setQuery, results, isLoading, error } = useProductSearch()

  useEffect(() => {
    const timeout = setTimeout(() => onSearchChange(query.trim()), 250)
    return () => clearTimeout(timeout)
  }, [query, onSearchChange])

  function handlePanelClick(panel: ActivePanel) {
    onTogglePanel(activePanel === panel ? null : panel)
  }

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
          {/* Botón Filtros (Marcas) */}
          <button
            type="button"
            onClick={() => handlePanelClick('filters')}
            aria-pressed={activePanel === 'filters'}
          >
            <FilterIcon />
            Filtros
          </button>

          {/* Botón Categorías */}
          <button
            type="button"
            onClick={() => handlePanelClick('categories')}
            aria-pressed={activePanel === 'categories'}
          >
            <GridIcon />
            Categorías
          </button>

          {/* Botón Ordenar y Precio */}
          <button
            type="button"
            onClick={() => handlePanelClick('price')}
            aria-pressed={activePanel === 'price'}
          >
            <SortIcon />
            Ordenar Por Precio
          </button>
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
