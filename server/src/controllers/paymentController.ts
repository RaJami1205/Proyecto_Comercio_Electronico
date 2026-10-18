/** Conecta la solicitud HTTP de pago con el servicio del Sandbox y propaga errores a Express. */
import type { NextFunction, Request, Response } from 'express'
import { paymentService } from '../services/paymentService.js'

/** Procesa el cuerpo HTTP para la Order de la ruta y devuelve el resultado o delega el error a Express. */
export async function processPayment(request: Request, response: Response, next: NextFunction): Promise<void> {
  try {
    response.status(200).json(await paymentService.process(String(request.params.orderId), request.body))
  } catch (error) {
    next(error)
  }
}
