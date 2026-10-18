/** Asocia las rutas de creación, consulta y pago de Orders con sus controladores. */
import { Router } from 'express'
import { createOrder, getOrder } from '../controllers/orderController.js'
import { processPayment } from '../controllers/paymentController.js'

const ordersRouter = Router()
ordersRouter.post('/', createOrder)
ordersRouter.get('/:orderId', getOrder)
ordersRouter.post('/:orderId/payment', processPayment)
export default ordersRouter
