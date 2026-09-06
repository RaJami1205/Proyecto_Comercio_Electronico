import type { NextFunction, Request, Response } from 'express'

import {
  mapProductRecord,
  mapSearchProductRecord,
} from '../mappers/productMapper.js'
import { getCatalogPage, searchProducts } from '../services/productService.js'

const DEFAULT_PRODUCTS_PER_PAGE = 20
const MAX_PRODUCTS_PER_PAGE = 100

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
    const result = await getCatalogPage(requestedPage - 1, productsPerPage)

    response.json({
      products: result.hits.map(mapProductRecord),
      page: result.page + 1,
      totalPages: Math.max(result.totalPages, 1),
      totalProducts: result.totalProducts,
    })
  } catch (error) {
    next(error)
  }
}

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
    next(error)
  }
}
