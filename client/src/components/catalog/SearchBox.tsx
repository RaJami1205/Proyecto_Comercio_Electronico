import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import type { ProductSearchResult } from '../../services/productApi'
import { useRecentSearches } from '../../hooks/useRecentSearches'
import styles from '../../styles/catalog/SearchBox.module.css'

// Dibuja el icono de lupa utilizado para indicar la acción 
// de búsqueda visualmente en la interfaz
function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="11" cy="11" r="7" />
      <path d="m16.25 16.25 4 4" />
    </svg>
  )
}

// Dibuja el icono de una "X" utilizado para limpiar el texto 
// ingresado o cerrar paneles desplegables
function ClearIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="m4 4 12 12M16 4 4 16" />
    </svg>
  )
}

// Dibuja el icono de un reloj, representando el historial 
// de búsquedas recientes realizadas por el usuario
function HistoryIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" fill="none">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" />
      <path d="M12 6v6l4 2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  )
}

// Define las propiedades esperadas por el componente SearchBox,
// incluyendo el estado de la consulta, los resultados y callbacks
interface SearchBoxProps {
  query: string
  onQueryChange: (value: string) => void
  results: ProductSearchResult[]
  isLoading: boolean
  error: string | null
  onSelectResult: (product: ProductSearchResult) => void
}

// Procesa un string que contiene etiquetas HTML <mark> (de Algolia)
// y lo convierte en un arreglo de elementos React para resaltarlo
function renderHighlighted(value: string) {
  return value.split(/(<mark>.*?<\/mark>)/g).map((part, index) => {
    if (part.startsWith('<mark>') && part.endsWith('</mark>')) {
      return <mark key={`${part}-${index}`}>{part.slice(6, -7)}</mark>
    }
    return part
  })
}

// Componente principal de la búsqueda experta avanzada.
// Gestiona el autocompletado inline, el panel de sugerencias y el historial local
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
  
  // Referencia para saber si el usuario está borrando texto
  // y así evitar lanzar la predicción automática accidentalmente
  const isDeletingRef = useRef(false)

  const { recentSearches, addRecentSearch, removeRecentSearch } = useRecentSearches()

  const showPanel = isOpen && (query.trim().length > 0 || recentSearches.length > 0)

  // Escucha los clics fuera del contenedor del SearchBox para 
  // cerrar automáticamente el panel de sugerencias
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

  // Limpia el índice de navegación por teclado y oculta 
  // el panel desplegable de sugerencias y búsquedas recientes
  function closeSuggestions() {
    setIsOpen(false)
    setActiveIndex(-1)
  }

  // Agrega la consulta al historial local, notifica al componente 
  // padre sobre la selección final y cierra el panel
  function selectResult(product: ProductSearchResult) {
    addRecentSearch(query)
    onSelectResult(product)
    closeSuggestions()
  }

  // Intercepta eventos de teclado para navegar la lista, descartar
  // predicciones (Backspace), aceptar sugerencias (Tab) y buscar (Enter)
  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    // Si presiona Backspace o Delete y hay una predicción sombreada:
    if (event.key === 'Backspace' || event.key === 'Delete') {
      isDeletingRef.current = true
      if (inputRef.current && inputRef.current.selectionStart !== inputRef.current.selectionEnd) {
        event.preventDefault()
        const userLength = inputRef.current.selectionStart ?? 0
        const preservedText = query.slice(0, userLength)
        onQueryChange(preservedText)
        setTimeout(() => {
          if (inputRef.current) {
            inputRef.current.setSelectionRange(userLength, userLength)
          }
        }, 0)
        return
      }
    } else {
      isDeletingRef.current = false
    }

    // Aceptar la sugerencia con Flecha Derecha o Tab
    if (event.key === 'ArrowRight' || event.key === 'Tab') {
      if (inputRef.current && inputRef.current.selectionStart !== inputRef.current.selectionEnd) {
        const length = inputRef.current.value.length
        inputRef.current.setSelectionRange(length, length)
        if (event.key === 'Tab') event.preventDefault()
        return
      }
    }

    if (isLoading && query.trim().length > 0) return

    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setIsOpen(true)
      if (query.trim().length > 0 && results.length > 0) {
        setActiveIndex((current) => (current + 1) % results.length)
      }
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setIsOpen(true)
      if (query.trim().length > 0 && results.length > 0) {
        setActiveIndex((current) => (current <= 0 ? results.length - 1 : current - 1))
      }
    } else if (event.key === 'Enter') {
      event.preventDefault()
      if (query.trim().length === 0) return

      if (showPanel && activeIndex >= 0 && results[activeIndex] && query.trim().length > 0) {
        addRecentSearch(query)
        selectResult(results[activeIndex])
      } else {
        addRecentSearch(query)
        closeSuggestions()
        inputRef.current?.focus({ preventScroll: true })
      }
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
          onFocus={() => setIsOpen(true)}
          onKeyDown={handleKeyDown}
          onChange={(event) => {
            const typedValue = event.target.value
            let newValue = typedValue
            const originalLength = typedValue.length

            if (!isDeletingRef.current && typedValue.length > 0) {
              // 1. Prioriza sugerir productos del catálogo
              const catalogMatch = results.find((r) =>
                r.name.toLowerCase().startsWith(typedValue.toLowerCase())
              )

              let match = catalogMatch ? catalogMatch.name : undefined

              // 2. Si no hay en catálogo, busca en búsquedas recientes
              if (!match) {
                match = recentSearches.find((search) =>
                  search.toLowerCase().startsWith(typedValue.toLowerCase())
                )
              }

              if (match) {
                newValue = typedValue + match.slice(typedValue.length)
              }
            }

            onQueryChange(newValue)
            setActiveIndex(-1)
            setIsOpen(true)

            if (newValue !== typedValue) {
              setTimeout(() => {
                if (inputRef.current) {
                  inputRef.current.setSelectionRange(originalLength, newValue.length)
                }
              }, 0)
            }
          }}
          placeholder="Buscar laptops, componentes, accesorios..."
        />
        <button
          className={styles.clearButton}
          type="button"
          aria-label="Borrar búsqueda"
          disabled={!query}
          onClick={() => {
            onQueryChange('')
            inputRef.current?.focus({ preventScroll: true })
            setIsOpen(true)
          }}
        >
          <ClearIcon />
        </button>
      </div>

      {showPanel ? (
        <div className={styles.panel}>
          <div className={styles.panelHeader}>
            <span>{query.trim().length === 0 ? 'Recientes' : 'Sugerencias'}</span>
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
            {query.trim().length === 0 && recentSearches.length > 0 ? (
              <>
                <div className={styles.recentHeader}>Búsquedas recientes</div>
                <ul className={styles.recentList} role="presentation">
                  {recentSearches.map((recent) => (
                    <li key={recent} role="presentation">
                      <button
                        type="button"
                        className={styles.recentItem}
                        onClick={() => {
                          onQueryChange(recent)
                          addRecentSearch(recent)
                          closeSuggestions()
                        }}
                      >
                        <span className={styles.recentItemContent}>
                          <HistoryIcon />
                          <span>{recent}</span>
                        </span>
                        <span
                          role="button"
                          tabIndex={0}
                          className={styles.removeRecent}
                          onClick={(e) => {
                            e.stopPropagation()
                            removeRecentSearch(recent)
                          }}
                          title="Eliminar búsqueda"
                        >
                          <ClearIcon />
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <>
                {isLoading ? <p className={styles.status}>Buscando...</p> : null}
                {error ? <p className={styles.error}>{error}</p> : null}
                {!isLoading && !error && results.length === 0 && query.trim().length > 0 ? (
                  <p className={styles.status}>No encontramos resultados para "{query}".</p>
                ) : null}
                {!isLoading && !error && results.length > 0 && query.trim().length > 0 ? (
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