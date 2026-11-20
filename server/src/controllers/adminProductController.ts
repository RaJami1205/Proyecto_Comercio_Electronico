/** Conecta la consulta administrativa Read-Only de productos con su servicio; RBAC se aplica antes en la ruta. */
import type { NextFunction, Request } from 'express'
import type { AuthorizedResponse } from '../middleware/authorization.js'
import { getAdminProduct, listAdminProducts, parseAdminProductQuery } from '../services/adminProductService.js'

/** Valida filtros y paginación antes de consultar el catálogo. */
export async function listAdminProductsHandler(request: Request, response: AuthorizedResponse, next: NextFunction): Promise<void> {
  try { response.status(200).json(await listAdminProducts(parseAdminProductQuery(request.query))) }
  catch (error) { next(error) }
}

/** Devuelve el detalle administrativo o PRODUCT_NOT_FOUND. */
export async function getAdminProductHandler(request: Request, response: AuthorizedResponse, next: NextFunction): Promise<void> {
  try { response.status(200).json(await getAdminProduct(request.params.productId)) }
  catch (error) { next(error) }
}
