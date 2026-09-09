// server/src/controllers/debugController.ts (temporal, se borra después)
import type { Request, Response, NextFunction } from 'express'
import { getAlgoliaClient } from '../config/algolia.js'
import { getAlgoliaConfig } from '../config/env.js'

export async function debugTaxonomy(
  request: Request,
  response: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { indexName } = getAlgoliaConfig()
    const result = await getAlgoliaClient().searchSingleIndex({
      indexName,
      searchParams: {
        query: '',
        hitsPerPage: 1000,
        attributesToRetrieve: ['categories', 'brand'],
      },
    })
    response.json(result.hits)
  } catch (error) {
    next(error)
  }
}