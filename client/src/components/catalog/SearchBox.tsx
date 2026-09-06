import { useState, type KeyboardEvent } from 'react'
import type { ProductSearchResult } from '../../services/productApi'
import styles from '../../styles/catalog/SearchBox.module.css'

function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="11" cy="11" r="7" />
      <path d="m16.25 16.25 4 4" />
    </svg>
  )
}

function ClearIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="m4 4 12 12M16 4 4 16" />
    </svg>
  )
}

interface SearchBoxProps {
  query: string
  onQueryChange: (value: string) => void
  results: ProductSearchResult[]
  isLoading: boolean
  error: string | null
  onSelectResult: (product: ProductSearchResult) => void
}

function renderHighlighted(value: string) {
  return value.split(/(<mark>.*?<\/mark>)/g).map((part, index) => {
    if (part.startsWith('<mark>') && part.endsWith('</mark>')) {
      return <mark key={`${part}-${index}`}>{part.slice(6, -7)}</mark>
    }

    return part
  })
}

function SearchBox({
  query,
  onQueryChange,
  results,
  isLoading,
  error,
  onSelectResult,
}: SearchBoxProps) {
  const [activeIndex, setActiveIndex] = useState(-1)
  const showPanel = query.trim().length > 0

  function selectResult(product: ProductSearchResult) {
    onSelectResult(product)
    onQueryChange('')
    setActiveIndex(-1)
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (!showPanel || results.length === 0) {
      return
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActiveIndex((current) => (current + 1) % results.length)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActiveIndex((current) => (current <= 0 ? results.length - 1 : current - 1))
    } else if (event.key === 'Enter' && activeIndex >= 0) {
      event.preventDefault()
      selectResult(results[activeIndex])
    } else if (event.key === 'Escape') {
      onQueryChange('')
      setActiveIndex(-1)
    }
  }

  return (
    <div className={styles.wrapper} role="search" aria-label="Búsqueda de productos">
      <div className={styles.inputRow}>
        <span className={styles.searchIcon}>
          <SearchIcon />
        </span>
        <label className={styles.visuallyHidden} htmlFor="catalog-search">
          Buscar en el catálogo
        </label>
        <input
          id="catalog-search"
          type="text"
          value={query}
          role="combobox"
          aria-expanded={showPanel}
          aria-controls="catalog-search-results"
          aria-activedescendant={
            activeIndex >= 0 ? `search-result-${activeIndex}` : undefined
          }
          autoComplete="off"
          onChange={(event) => {
            onQueryChange(event.target.value)
            setActiveIndex(-1)
          }}
          onKeyDown={handleKeyDown}
          placeholder="Buscar laptops, componentes, accesorios..."
        />
        <button
          className={styles.clearButton}
          type="button"
          aria-label="Borrar búsqueda"
          disabled={!query}
          onClick={() => {
            onQueryChange('')
            setActiveIndex(-1)
          }}
        >
          <ClearIcon />
        </button>
      </div>

      {showPanel ? (
        <div className={styles.panel} id="catalog-search-results" role="listbox">
          {isLoading ? <p className={styles.status}>Buscando…</p> : null}

          {error ? <p className={styles.error}>{error}</p> : null}

          {!isLoading && !error && results.length === 0 ? (
            <p className={styles.status}>No encontramos resultados para "{query}".</p>
          ) : null}

          {results.length > 0 ? (
            <ul className={styles.results}>
              {results.map((hit, index) => {
                const highlightedName = hit.highlightedName ?? hit.name

                return (
                  <li key={hit.id}>
                    <button
                      type="button"
                      id={`search-result-${index}`}
                      role="option"
                      aria-selected={index === activeIndex}
                      className={`${styles.resultItem} ${
                        index === activeIndex ? styles.resultItemActive : ''
                      }`}
                      onMouseEnter={() => setActiveIndex(index)}
                      onClick={() => selectResult(hit)}
                    >
                      <p className={styles.resultCategory}>{hit.category}</p>
                      <p className={styles.resultName}>
                        {renderHighlighted(highlightedName)}
                      </p>
                      {hit.brand ? (
                        <p className={styles.resultBrand}>{hit.brand}</p>
                      ) : null}
                    </button>
                  </li>
                )
              })}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

export default SearchBox
