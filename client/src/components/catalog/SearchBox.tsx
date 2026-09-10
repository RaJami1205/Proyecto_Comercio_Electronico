import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
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
  const [isOpen, setIsOpen] = useState(false)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const showPanel = isOpen && query.trim().length > 0

  useEffect(() => {
    function handlePointerDown(event: PointerEvent) {
      if (event.target instanceof Node && !wrapperRef.current?.contains(event.target)) {
        setIsOpen(false)
        setActiveIndex(-1)
      }
    }

    document.addEventListener('pointerdown', handlePointerDown)
    return () => document.removeEventListener('pointerdown', handlePointerDown)
  }, [])

  function closeSuggestions() {
    setIsOpen(false)
    setActiveIndex(-1)
  }

  function selectResult(product: ProductSearchResult) {
    onSelectResult(product)
    closeSuggestions()
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (isLoading || results.length === 0) {
      return
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setIsOpen(true)
      setActiveIndex((current) => (current + 1) % results.length)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setIsOpen(true)
      setActiveIndex((current) => (current <= 0 ? results.length - 1 : current - 1))
    } else if (event.key === 'Enter' && showPanel && activeIndex >= 0 && results[activeIndex]) {
      event.preventDefault()
      selectResult(results[activeIndex])
    }
  }

  return (
    <div
      ref={wrapperRef}
      className={styles.wrapper}
      role="search"
      aria-label="Búsqueda de productos"
      onBlur={(event) => {
        if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget)) {
          closeSuggestions()
        }
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault()
          inputRef.current?.focus({ preventScroll: true })
          closeSuggestions()
        }
      }}
    >
      <div className={styles.inputRow}>
        <span className={styles.searchIcon}>
          <SearchIcon />
        </span>
        <label className={styles.visuallyHidden} htmlFor="catalog-search">
          Buscar en el catálogo
        </label>
        <input
          id="catalog-search"
          ref={inputRef}
          type="text"
          value={query}
          role="combobox"
          aria-expanded={showPanel}
          aria-controls={showPanel ? 'catalog-search-results' : undefined}
          aria-autocomplete="list"
          aria-activedescendant={
            showPanel && !isLoading && results[activeIndex] ? `search-result-${activeIndex}` : undefined
          }
          autoComplete="off"
          onChange={(event) => {
            onQueryChange(event.target.value)
            setActiveIndex(-1)
            setIsOpen(true)
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
            closeSuggestions()
            inputRef.current?.focus({ preventScroll: true })
          }}
        >
          <ClearIcon />
        </button>
      </div>

      {showPanel ? (
        <div className={styles.panel}>
          <div className={styles.panelHeader}>
            <span>Sugerencias</span>
            <button
              className={styles.closeSuggestions}
              type="button"
              aria-label="Cerrar sugerencias"
              title="Cerrar sugerencias"
              onClick={() => {
                closeSuggestions()
                inputRef.current?.focus({ preventScroll: true })
              }}
            >
              <ClearIcon />
            </button>
          </div>
          <div
            id="catalog-search-results"
            role="listbox"
            aria-label="Sugerencias de productos"
            aria-busy={isLoading}
          >
            {isLoading ? <p className={styles.status}>Buscando…</p> : null}

            {error ? <p className={styles.error}>{error}</p> : null}

            {!isLoading && !error && results.length === 0 ? (
              <p className={styles.status}>No encontramos resultados para "{query}".</p>
            ) : null}

            {!isLoading && !error && results.length > 0 ? (
              <ul className={styles.results} role="presentation">
                {results.map((hit, index) => {
                  const highlightedName = hit.highlightedName ?? hit.name

                  return (
                    <li key={hit.id} role="presentation">
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
        </div>
      ) : null}
    </div>
  )
}

export default SearchBox
