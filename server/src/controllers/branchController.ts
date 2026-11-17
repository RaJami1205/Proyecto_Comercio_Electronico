/** Publica el catálogo tipado de sucursales sin exponer inventario ni estado editable. */
import type { NextFunction, Request, Response } from 'express'
import { getBranches } from '../services/branchService.js'

export function listBranches(_request: Request, response: Response, next: NextFunction): void {
  try { response.status(200).json({ branches: getBranches() }) }
  catch (error) { next(error) }
}
