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
  const [recentSearches, setRecentSearches] = useState<string[]>([])
  const wrapperRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const isDeletingRef = useRef(false)
  const predictionRef = useRef<{ start: number; value: string } | null>(null)
  const showRecents = query.trim().length === 0 && recentSearches.length > 0
  const showPanel = isOpen && (query.trim().length > 0 || showRecents)

  useEffect(() => {
    function handlePointerDown(event: PointerEvent) {
      if (event.target instanceof Node && !wrapperRef.current?.contains(event.target)) {
        predictionRef.current = null
        setIsOpen(false)
        setActiveIndex(-1)
      }
    }

    document.addEventListener('pointerdown', handlePointerDown)
    return () => document.removeEventListener('pointerdown', handlePointerDown)
  }, [])

  function closeSuggestions() {
    predictionRef.current = null
    setIsOpen(false)
    setActiveIndex(-1)
  }

  function selectResult(product: ProductSearchResult) {
    addRecentSearch(query)
    onSelectResult(product)
    closeSuggestions()
  }

  function addRecentSearch(value: string) {
    const trimmed = value.trim()
    if (!trimmed) return
    setRecentSearches((current) => [
      trimmed,
      ...current.filter((recent) => recent.toLowerCase() !== trimmed.toLowerCase()),
    ].slice(0, 5))
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    const input = event.currentTarget
    const prediction = predictionRef.current
    const hasPredictiveSelection = prediction !== null && input.value === prediction.value &&
      input.selectionStart === prediction.start && input.selectionEnd === prediction.value.length

    isDeletingRef.current = event.key === 'Backspace' || event.key === 'Delete'
    if (hasPredictiveSelection && isDeletingRef.current) {
      event.preventDefault()
      predictionRef.current = null
      onQueryChange(input.value.slice(0, prediction.start))
      return
    }
    if (hasPredictiveSelection && (event.key === 'Tab' || event.key === 'ArrowRight')) {
      input.setSelectionRange(input.value.length, input.value.length)
      predictionRef.current = null
      if (event.key === 'Tab') event.preventDefault()
      return
    }

    if (event.key === 'Enter' && query.trim()) {
      event.preventDefault()
      if (!isLoading && showPanel && activeIndex >= 0 && results[activeIndex]) {
        selectResult(results[activeIndex])
      } else {
        addRecentSearch(query)
        closeSuggestions()
      }
      return
    }

    if (isLoading || results.length === 0 || !query.trim()) {
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
          aria-haspopup={showRecents ? 'dialog' : 'listbox'}
          aria-activedescendant={
            showPanel && !showRecents && !isLoading && results[activeIndex] ? `search-result-${activeIndex}` : undefined
          }
          autoComplete="off"
          onFocus={(event) => {
            // Returning focus from clear/close must not reopen the panel.
            if (showRecents && !wrapperRef.current?.contains(event.relatedTarget)) {
              setIsOpen(true)
            }
          }}
          onClick={() => {
            if (showRecents) setIsOpen(true)
          }}
          onChange={(event) => {
            const typedValue = event.target.value
            const nativeEvent = event.nativeEvent
            const isDeleting = isDeletingRef.current ||
              (nativeEvent instanceof InputEvent && nativeEvent.inputType.startsWith('delete'))
            const isComposing = nativeEvent instanceof InputEvent && nativeEvent.isComposing
            isDeletingRef.current = false
            predictionRef.current = null

            const match = !isDeleting && !isComposing && typedValue.length > 0
              ? results.find((result) => result.name.toLowerCase().startsWith(typedValue.toLowerCase()))
              : undefined
            const newValue = match ? typedValue + match.name.slice(typedValue.length) : typedValue

            onQueryChange(newValue)
            setActiveIndex(-1)
            setIsOpen(true)

            if (newValue !== typedValue) {
              const prediction = { start: typedValue.length, value: newValue }
              predictionRef.current = prediction
              setTimeout(() => {
                const input = inputRef.current
                // Ignore callbacks superseded by typing, clear/close, or loss of focus.
                if (predictionRef.current === prediction && input &&
                    document.activeElement === input && input.value === prediction.value) {
                  input.setSelectionRange(prediction.start, prediction.value.length)
                }
              }, 0)
            }
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
            <span>{showRecents ? 'Recientes' : 'Sugerencias'}</span>
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
            role={showRecents ? 'dialog' : 'listbox'}
            aria-label={showRecents ? 'Búsquedas recientes' : 'Sugerencias de productos'}
            aria-busy={!showRecents && isLoading}
          >
            {showRecents ? (
              <ul className={styles.recentList}>
                {recentSearches.map((recent) => (
                  <li key={recent} className={styles.recentItem}>
                    <button
                      type="button"
                      className={styles.recentItemContent}
                      onClick={() => {
                        onQueryChange(recent)
                        addRecentSearch(recent)
                        inputRef.current?.focus({ preventScroll: true })
                        closeSuggestions()
                      }}
                    >
                      {recent}
                    </button>
                    <button
                      type="button"
                      className={styles.removeRecent}
                      aria-label={`Eliminar búsqueda: ${recent}`}
                      onClick={() => {
                        setRecentSearches((current) => current.filter(
                          (value) => value.toLowerCase() !== recent.toLowerCase(),
                        ))
                        inputRef.current?.focus({ preventScroll: true })
                      }}
                    >
                      <ClearIcon />
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <>
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
              </>
            )}
          </div>
        </div>
      ) : null}
    </div>
  )
}

export default SearchBox
