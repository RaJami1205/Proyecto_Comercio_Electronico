import styles from './CatalogToolbar.module.css'

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

function CatalogToolbar() {
  return (
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
  )
}

export default CatalogToolbar
