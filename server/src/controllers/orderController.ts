import type { NextFunction, Request, Response } from 'express'
import { orderService } from '../services/orderService.js'

export async function createOrder(request: Request, response: Response, next: NextFunction): Promise<void> {
  try { response.status(201).json(await orderService.create(request.body)) }
  catch (error) { next(error) }
}

export function getOrder(request: Request, response: Response, next: NextFunction): void {
  try { response.status(200).json(orderService.findById(String(request.params.orderId))) }
  catch (error) { next(error) }
}
