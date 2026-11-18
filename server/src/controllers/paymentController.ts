/** Conecta la solicitud HTTP de pago con el servicio del Sandbox y propaga errores a Express. */
import type { NextFunction, Request } from 'express'
import { requirePaymentActor } from '../domain/orderAccess.js'
import type { AuthorizedResponse } from '../middleware/authorization.js'
import { paymentService } from '../services/paymentService.js'

/** Procesa el cuerpo HTTP para la Order de la ruta y devuelve el resultado o delega el error a Express. */
export async function processPayment(request: Request, response: AuthorizedResponse, next: NextFunction): Promise<void> {
  try {
    // La propiedad se verifica dentro de la persistencia, antes del Sandbox y de cualquier Replay.
    response.status(200).json(await paymentService.process(String(request.params.orderId), request.body, requirePaymentActor(response.locals.user)))
  } catch (error) {
    next(error)
  }
}
