import type { NextFunction, Request, Response } from 'express'
import { getCategoryTree } from '../services/categoryService.js'

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

function parseArrayParam(value: unknown): string[] | undefined {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === 'string')
  }
  if (typeof value === 'string' && value.trim()) {
    return [value]
  }
  return undefined
}

function parseNonNegativeNumber(value: unknown): number | undefined {
  if (typeof value !== 'string' || !value.trim()) {
    return undefined
  }
  const parsedValue = Number(value)
  return Number.isFinite(parsedValue) && parsedValue >= 0 ? parsedValue : undefined
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

    const categories = parseArrayParam(request.query.categories)
    const brands = parseArrayParam(request.query.brands)
    const minPrice = parseNonNegativeNumber(request.query.minPrice)
    const maxPrice = parseNonNegativeNumber(request.query.maxPrice)

    const result = await getCatalogPage(requestedPage - 1, productsPerPage, {
      categories,
      brands,
      minPrice,
      maxPrice,
    })

    response.json({
      products: result.hits.map(mapProductRecord),
      page: result.page + 1,
      totalPages: Math.max(result.totalPages, 1),
      totalProducts: result.totalProducts,
      facets: result.facets,
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

export async function getCategoryTreeHandler(
  request: Request,
  response: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const tree = await getCategoryTree()
    response.json({ tree })
  } catch (error) {
    next(error)
  }
}