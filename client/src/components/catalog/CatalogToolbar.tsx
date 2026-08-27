import { useRef, useState } from 'react'

import styles from '../../styles/catalog/CatalogToolbar.module.css'

function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="11" cy="11" r="7" />
      <path d="m16.25 16.25 4 4" />
    </svg>
  )
}

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

function ClearIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="m4 4 12 12M16 4 4 16" />
    </svg>
  )
}

function CatalogToolbar() {
  const [searchValue, setSearchValue] = useState('')
  const searchInputRef = useRef<HTMLInputElement>(null)

  function clearSearch() {
    setSearchValue('')
    searchInputRef.current?.focus()
  }

  return (
    <div className={styles.controlsBlock}>
      <div className={styles.searchGroup}>
        <div className={styles.search} role="search" aria-label="Búsqueda de productos">
          <label className={styles.visuallyHidden} htmlFor="catalog-search">
            Buscar en el catálogo
          </label>
          <span className={styles.searchIcon}>
            <SearchIcon />
          </span>
          <input
            ref={searchInputRef}
            id="catalog-search"
            type="search"
            value={searchValue}
            onChange={(event) => setSearchValue(event.target.value)}
            placeholder="Buscar laptops, componentes, accesorios..."
          />
          <button
            className={styles.clearButton}
            type="button"
            aria-label="Borrar búsqueda"
            disabled={!searchValue}
            onClick={clearSearch}
          >
            <ClearIcon />
          </button>
          <button className={styles.searchSubmit} type="button">
            Buscar
          </button>
        </div>
        <p className={styles.searchNote}>Interfaz de búsqueda en preparación</p>
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
          Catálogo en preparación
        </p>
      </div>
    </div>
  )
}

export default CatalogToolbar
