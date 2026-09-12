import { useCallback, useEffect, useState } from 'react'

// Define el punto de quiebre responsivo y las constantes de tamaño de página
// para adaptar la cantidad de productos visibles según la pantalla del usuario
const COMPACT_CATALOG_MEDIA_QUERY = '(max-width: 1060px)'
const DESKTOP_PAGE_SIZE = 9
const COMPACT_PAGE_SIZE = 6

// Interfaz para gestionar el estado interno de la paginación,
// rastreando la página actual y el límite de elementos por página
interface CatalogPaginationState {
  currentPage: number
  pageSize: number
}

// Función auxiliar que determina el tamaño de página inicial adecuado
// evaluando las dimensiones actuales de la ventana del navegador
function getPageSize(): number {
  if (typeof window === 'undefined') {
    return DESKTOP_PAGE_SIZE
  }

  return window.matchMedia(COMPACT_CATALOG_MEDIA_QUERY).matches
    ? COMPACT_PAGE_SIZE
    : DESKTOP_PAGE_SIZE
}

// Hook personalizado que maneja la lógica de paginación del catálogo
// Escucha cambios en el tamaño de la ventana para ajustar el número
// de productos por página dinámicamente y reinicia a la página 1 si es necesario
export function useCatalogPagination() {
  const [pagination, setPagination] = useState<CatalogPaginationState>(() => ({
    currentPage: 1,
    pageSize: getPageSize(),
  }))

  // Efecto que registra un listener para el media query de ancho de pantalla
  // Ajusta la cantidad de productos visibles cuando el usuario redimensiona la ventana
  useEffect(() => {
    const mediaQuery = window.matchMedia(COMPACT_CATALOG_MEDIA_QUERY)

    function updatePageSize(matches: boolean) {
      const pageSize = matches ? COMPACT_PAGE_SIZE : DESKTOP_PAGE_SIZE

      setPagination((current) =>
        current.pageSize === pageSize
          ? current
          : {
              currentPage: 1,
              pageSize,
            },
      )
    }

    function handleMediaQueryChange(event: MediaQueryListEvent) {
      updatePageSize(event.matches)
    }

    updatePageSize(mediaQuery.matches)
    mediaQuery.addEventListener('change', handleMediaQueryChange)

    return () => mediaQuery.removeEventListener('change', handleMediaQueryChange)
  }, [])

  // Función memorizada para actualizar la página activa de forma segura
  // Evita re-renderizados innecesarios si la página solicitada es la misma
  const setCurrentPage = useCallback((currentPage: number) => {
    setPagination((current) =>
      current.currentPage === currentPage
        ? current
        : {
            ...current,
            currentPage,
          },
    )
  }, [])

  return {
    currentPage: pagination.currentPage,
    pageSize: pagination.pageSize,
    setCurrentPage,
  }
}
