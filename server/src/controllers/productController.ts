/** Valida parámetros HTTP y transforma resultados de los services en responses públicas mediante mappers. */
import type { NextFunction, Request, Response } from 'express'
import { getCategoryTree } from '../services/categoryService.js'

import {
  mapProductRecord,
  mapSearchProductRecord,
} from '../mappers/productMapper.js'
import { getCatalogPage, searchProducts } from '../services/productService.js'

const DEFAULT_PRODUCTS_PER_PAGE = 20
const MAX_PRODUCTS_PER_PAGE = 100

/** Normaliza paginación con fallback y límite superior para entradas inválidas. */
function parsePositiveInteger(
  value: unknown,
  fallback: number,
  maximum = Number.MAX_SAFE_INTEGER,
): number {
  if (typeof value !== 'string') {
    return fallback
  }

  const parsedValue = Number(value)

  if (!Number.isInteger(parsedValue) || parsedValue < 1) {
    return fallback
  }

  return Math.min(parsedValue, maximum)
}

/** Admite valores repetidos o únicos y descarta entradas que no sean strings. */
function parseArrayParam(value: unknown): string[] | undefined {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === 'string')
  }
  if (typeof value === 'string' && value.trim()) {
    return [value]
  }
  return undefined
}

/** Acepta límites de precio finitos y no negativos desde query parameters. */
function parseNonNegativeNumber(value: unknown): number | undefined {
  if (typeof value !== 'string' || !value.trim()) {
    return undefined
  }
  const parsedValue = Number(value)
  return Number.isFinite(parsedValue) && parsedValue >= 0 ? parsedValue : undefined
}

/** Normaliza filtros y paginación antes de devolver productos mapeados y facets. */
export async function getProducts(
  request: Request,
  response: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const requestedPage = parsePositiveInteger(request.query.page, 1)
    const productsPerPage = parsePositiveInteger(
      request.query.perPage,
      DEFAULT_PRODUCTS_PER_PAGE,
      MAX_PRODUCTS_PER_PAGE,
    )

    const categories = parseArrayParam(request.query.categories)
    const query = typeof request.query.q === 'string' ? request.query.q.trim() : ''
    const brands = parseArrayParam(request.query.brands)
    const minPrice = parseNonNegativeNumber(request.query.minPrice)
    const maxPrice = parseNonNegativeNumber(request.query.maxPrice)
    const sort = typeof request.query.sort === 'string' ? request.query.sort : 'relevance'

    // El service convierte requestedPage de base uno a la base cero de Algolia.
    const result = await getCatalogPage(
      requestedPage,
      productsPerPage,
      {
        categories,
        brands,
        minPrice,
        maxPrice,
        sort,
      },
      query,
    )

    // El service devuelve result.page en base uno para el cliente.
    response.json({
      products: result.hits.map(mapProductRecord),
      page: result.page,
      totalPages: Math.max(result.totalPages, 1),
      totalProducts: result.totalProducts,
      facets: result.facets,
    })
  } catch (error) {
    console.error('Error procesando consulta de catálogo en getProducts:', error)
    next(error)
  }
}

/** Rechaza queries vacíos y devuelve sugerencias con highlights del mapper. */
export async function searchProductCatalog(
  request: Request,
  response: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const query = typeof request.query.q === 'string' ? request.query.q.trim() : ''

    if (!query) {
      response.status(400).json({
        error: 'El parámetro de búsqueda "q" es obligatorio.',
      })
      return
    }

    const hits = await searchProducts(query)
    response.json({ products: hits.map(mapSearchProductRecord) })
  } catch (error) {
    console.error('Error procesando búsqueda en searchProductCatalog:', error)
    next(error)
  }
}

/** Entrega el árbol del service y delega fallos al middleware de errores. */
export async function getCategoryTreeHandler(
  request: Request,
  response: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const tree = await getCategoryTree()
    response.json({ tree })
  } catch (error) {
    console.error('Error obteniendo árbol de categorías:', error)
    next(error)
  }
}