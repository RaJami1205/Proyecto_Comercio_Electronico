/** Conecta las solicitudes HTTP de creación y consulta de Orders con el servicio y el manejo de errores. */
import type { NextFunction, Request } from 'express'
import type { AuthorizedResponse } from '../middleware/authorization.js'
import { orderService } from '../services/orderService.js'
import { serverConfig } from '../config/env.js'

/** Conserva Checkout B2C V1; tras el corte V2 solo permite Replay compatible de claves existentes. */
export async function createOrder(request: Request, response: AuthorizedResponse, next: NextFunction): Promise<void> {
  try {
    const order = await orderService.create(request.body, response.locals.user,
      { replayOnly: serverConfig.orderCreationMode === 'v2-only' })
    response.status(201).json(order)
  } catch (error) { next(error) }
}

/** Crea Orders V2; la identidad y el rol vienen del middleware de autorización. */
export async function createOrderV2(request: Request, response: AuthorizedResponse, next: NextFunction): Promise<void> {
  try { response.status(201).json(await orderService.createV2(request.body, response.locals.user)) }
  catch (error) { next(error) }
}

/** Busca la Order por el identificador de la ruta, responde con su snapshot y propaga errores a Express. */
export async function getOrder(request: Request, response: AuthorizedResponse, next: NextFunction): Promise<void> {
  try { response.status(200).json(await orderService.findById(String(request.params.orderId), response.locals.user.id)) }
  catch (error) { next(error) }
}
