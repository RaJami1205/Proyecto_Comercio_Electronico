import styles from '../../styles/catalog/Pagination.module.css'

// Define las propiedades del componente Pagination, incluyendo
// la página actual, el total de páginas y las funciones
// para manejar el cambio de páginas
interface PaginationProps {
  currentPage: number
  totalPages: number
  onPageChange: (page: number) => void
  onDirectionalPageChange: (page: number) => void
}

// Tipo de dato que representa un elemento en la barra de paginación
// Puede ser un número exacto de página o un separador
type PaginationItem = number | 'ellipsis-start' | 'ellipsis-end'

// Calcula dinámicamente qué números de página y elipsis mostrar.
// Garantiza que siempre sean visibles la primera página, la última
// y las páginas adyacentes a la posición actual del usuario
function getPaginationItems(currentPage: number, totalPages: number): PaginationItem[] {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, index) => index + 1)
  }

  const nearbyPages = new Set([
    1,
    totalPages,
    currentPage - 1,
    currentPage,
    currentPage + 1,
  ])
  const visiblePages = [...nearbyPages]
    .filter((page) => page >= 1 && page <= totalPages)
    .sort((first, second) => first - second)
  const items: PaginationItem[] = []

  visiblePages.forEach((page, index) => {
    const previousPage = visiblePages[index - 1]

    if (previousPage && page - previousPage > 1) {
      items.push(previousPage === 1 ? 'ellipsis-start' : 'ellipsis-end')
    }

    items.push(page)
  })

  return items
}

// Dibuja el icono vectorial de flecha utilizado en los botones
// direccionales de la paginación. Cambia su orientación
// dependiendo de la dirección ("left" o "right")
function ArrowIcon({ direction }: { direction: 'left' | 'right' }) {
  return (
    <svg
      className={direction === 'right' ? styles.arrowRight : undefined}
      viewBox="0 0 20 20"
      aria-hidden="true"
    >
      <path d="m12.5 4.5-5.5 5.5 5.5 5.5" />
    </svg>
  )
}

// Componente de paginación fluido e integrado al estado de búsqueda
// Renderiza controles direccionales, números de página y un 
// indicador de estado simplificado para dispositivos móviles
function Pagination({
  currentPage,
  totalPages,
  onPageChange,
  onDirectionalPageChange,
}: PaginationProps) {
  const paginationItems = getPaginationItems(currentPage, totalPages)

  return (
    <nav className={styles.pagination} aria-label="Paginación del catálogo">
      <button
        className={`${styles.directionButton} ${styles.previousButton}`}
        type="button"
        aria-label="Página anterior"
        disabled={currentPage === 1}
        onClick={() => onDirectionalPageChange(currentPage - 1)}
      >
        <ArrowIcon direction="left" />
        <span>Anterior</span>
      </button>

      <div className={styles.pages}>
        {paginationItems.map((item) =>
          typeof item === 'number' ? (
            <button
              className={styles.pageButton}
              type="button"
              key={item}
              aria-label={`Ir a la página ${item}`}
              aria-current={item === currentPage ? 'page' : undefined}
              onClick={() => onPageChange(item)}
            >
              {item}
            </button>
          ) : (
            <span className={styles.ellipsis} key={item} aria-hidden="true">
              …
            </span>
          ),
        )}
      </div>

      <p className={styles.mobileStatus} aria-live="polite">
        Página {currentPage} de {totalPages}
      </p>

      <button
        className={`${styles.directionButton} ${styles.nextButton}`}
        type="button"
        aria-label="Página siguiente"
        disabled={currentPage === totalPages}
        onClick={() => onDirectionalPageChange(currentPage + 1)}
      >
        <span>Siguiente</span>
        <ArrowIcon direction="right" />
      </button>
    </nav>
  )
}

export default Pagination
