import type { ProductRecord } from '../../services/algoliaClient'
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
  results: ProductRecord[]
  isLoading: boolean
  error: string | null
}

function SearchBox({ query, onQueryChange, results, isLoading, error }: SearchBoxProps) {
  const showPanel = query.trim().length > 0

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
          type="search"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="Buscar laptops, componentes, accesorios..."
        />
        <button
          className={styles.clearButton}
          type="button"
          aria-label="Borrar búsqueda"
          disabled={!query}
          onClick={() => onQueryChange('')}
        >
          <ClearIcon />
        </button>
      </div>

      {showPanel ? (
        <div className={styles.panel}>
          {isLoading ? <p className={styles.status}>Buscando…</p> : null}

          {error ? <p className={styles.error}>{error}</p> : null}

          {!isLoading && !error && results.length === 0 ? (
            <p className={styles.status}>No encontramos resultados para "{query}".</p>
          ) : null}

          {results.length > 0 ? (
            <ul className={styles.results}>
              {results.map((hit) => (
                <li className={styles.resultItem} key={hit.objectID}>
                  <p className={styles.resultCategory}>{hit.category}</p>
                  <p className={styles.resultName}>{hit.name}</p>
                  {hit.brand ? <p className={styles.resultBrand}>{hit.brand}</p> : null}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

export default SearchBox
