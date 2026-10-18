/** Conecta las solicitudes HTTP de creación y consulta de Orders con el servicio y el manejo de errores. */
import type { NextFunction, Request, Response } from 'express'
import { orderService } from '../services/orderService.js'

/** Crea la Order desde el cuerpo HTTP, responde con su snapshot y delega los errores a Express. */
export async function createOrder(request: Request, response: Response, next: NextFunction): Promise<void> {
  try { response.status(201).json(await orderService.create(request.body)) }
  catch (error) { next(error) }
}

/** Busca la Order por el identificador de la ruta, responde con su snapshot y propaga errores a Express. */
export function getOrder(request: Request, response: Response, next: NextFunction): void {
  try { response.status(200).json(orderService.findById(String(request.params.orderId))) }
  catch (error) { next(error) }
}
