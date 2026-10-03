/** Mantiene página y tamaño de página coherentes con el breakpoint del catálogo. */
import { useCallback, useEffect, useState } from 'react'

const COMPACT_CATALOG_MEDIA_QUERY = '(max-width: 1060px)'
const DESKTOP_PAGE_SIZE = 9
const COMPACT_PAGE_SIZE = 6

interface CatalogPaginationState {
  currentPage: number
  pageSize: number
}

/** Resuelve el tamaño inicial según el viewport con fallback para entornos sin window. */
function getPageSize(): number {
  if (typeof window === 'undefined') {
    return DESKTOP_PAGE_SIZE
  }

  return window.matchMedia(COMPACT_CATALOG_MEDIA_QUERY).matches
    ? COMPACT_PAGE_SIZE
    : DESKTOP_PAGE_SIZE
}

/** Sincroniza la paginación con matchMedia sin asumir responsabilidad sobre requests. */
export function useCatalogPagination() {
  const [pagination, setPagination] = useState<CatalogPaginationState>(() => ({
    currentPage: 1,
    pageSize: getPageSize(),
  }))

  useEffect(() => {
    const mediaQuery = window.matchMedia(COMPACT_CATALOG_MEDIA_QUERY)

    /** Vuelve a la primera página solo cuando cambia la capacidad del viewport. */
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

    /** Traduce el cambio de breakpoint al tamaño de página del catálogo. */
    function handleMediaQueryChange(event: MediaQueryListEvent) {
      updatePageSize(event.matches)
    }

    updatePageSize(mediaQuery.matches)
    mediaQuery.addEventListener('change', handleMediaQueryChange)

    return () => mediaQuery.removeEventListener('change', handleMediaQueryChange)
  }, [])

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
