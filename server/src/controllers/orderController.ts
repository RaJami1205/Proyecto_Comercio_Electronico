/** Conecta las solicitudes HTTP de creación y consulta de Orders con el servicio y el manejo de errores. */
import type { NextFunction, Request } from 'express'
import type { AuthorizedResponse } from '../middleware/authorization.js'
import { orderService } from '../services/orderService.js'

/** Crea la Order desde el cuerpo HTTP, responde con su snapshot y delega los errores a Express. */
export async function createOrder(request: Request, response: AuthorizedResponse, next: NextFunction): Promise<void> {
  try { response.status(201).json(await orderService.create(request.body, response.locals.user.id)) }
  catch (error) { next(error) }
}

/** Busca la Order por el identificador de la ruta, responde con su snapshot y propaga errores a Express. */
export function getOrder(request: Request, response: AuthorizedResponse, next: NextFunction): void {
  try { response.status(200).json(orderService.findById(String(request.params.orderId), response.locals.user.id)) }
  catch (error) { next(error) }
}
