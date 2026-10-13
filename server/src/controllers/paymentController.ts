import type { NextFunction, Request, Response } from 'express'
import { paymentService } from '../services/paymentService.js'

export async function processPayment(request: Request, response: Response, next: NextFunction): Promise<void> {
  try {
    response.status(200).json(await paymentService.process(String(request.params.orderId), request.body))
  } catch (error) {
    next(error)
  }
}
