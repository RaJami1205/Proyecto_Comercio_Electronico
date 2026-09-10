import { useCallback, useEffect, useState } from 'react'

const COMPACT_CATALOG_MEDIA_QUERY = '(max-width: 1060px)'
const DESKTOP_PAGE_SIZE = 9
const COMPACT_PAGE_SIZE = 6

interface CatalogPaginationState {
  currentPage: number
  pageSize: number
}

function getPageSize(): number {
  if (typeof window === 'undefined') {
    return DESKTOP_PAGE_SIZE
  }

  return window.matchMedia(COMPACT_CATALOG_MEDIA_QUERY).matches
    ? COMPACT_PAGE_SIZE
    : DESKTOP_PAGE_SIZE
}

export function useCatalogPagination() {
  const [pagination, setPagination] = useState<CatalogPaginationState>(() => ({
    currentPage: 1,
    pageSize: getPageSize(),
  }))

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
