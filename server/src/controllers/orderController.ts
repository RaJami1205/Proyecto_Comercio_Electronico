/** Conecta las solicitudes HTTP de creación y consulta de Orders con el servicio y el manejo de errores. */
import type { NextFunction, Request } from 'express'
import type { AuthorizedResponse } from '../middleware/authorization.js'
import { orderService } from '../services/orderService.js'
import { OrderError } from '../domain/orderError.js'

/** Crea la Order desde el cuerpo HTTP, responde con su snapshot y delega los errores a Express. */
export async function createOrder(request: Request, response: AuthorizedResponse, next: NextFunction): Promise<void> {
  try { response.status(201).json(await orderService.create(request.body, response.locals.user)) }
  catch (error) { next(error) }
}

/** Crea Orders V2; la identidad y el rol vienen del middleware de autorización. */
export async function createOrderV2(request: Request, response: AuthorizedResponse, next: NextFunction): Promise<void> {
  try { response.status(201).json(await orderService.createV2(request.body, response.locals.user)) }
  catch (error) { next(error) }
}

/** Deshabilita V1 para impedir Orders sin sucursal ni validaciones comerciales. */
export function rejectLegacyOrderCreation(_request: Request, _response: AuthorizedResponse, next: NextFunction): void {
  next(new OrderError(410, 'ORDER_CONTRACT_DEPRECATED', 'La creación legacy está deshabilitada. Utiliza Orders V2 con sucursal seleccionada.'))
}

/** Busca la Order por el identificador de la ruta, responde con su snapshot y propaga errores a Express. */
export async function getOrder(request: Request, response: AuthorizedResponse, next: NextFunction): Promise<void> {
  try { response.status(200).json(await orderService.findById(String(request.params.orderId), response.locals.user.id)) }
  catch (error) { next(error) }
}
