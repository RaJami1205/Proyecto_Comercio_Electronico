/** Conecta la consulta administrativa global de Orders con su servicio; RBAC se aplica antes en la ruta. */
import type { NextFunction, Request } from 'express'
import type { AuthorizedResponse } from '../middleware/authorization.js'
import { adminOrderService } from '../services/adminOrderService.js'

/** Filtros, búsqueda y paginación llegan por query string y se validan en el dominio. */
export async function listAdminOrders(request: Request, response: AuthorizedResponse, next: NextFunction): Promise<void> {
  try { response.status(200).json(await adminOrderService.list(request.query as Record<string, unknown>)) }
  catch (error) { next(error) }
}
