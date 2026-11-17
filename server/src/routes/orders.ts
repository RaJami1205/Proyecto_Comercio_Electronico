/** Asocia las rutas de creación, consulta y pago de Orders con sus controladores. */
import { Router } from 'express'
import { createOrderV2, getOrder, rejectLegacyOrderCreation } from '../controllers/orderController.js'
import { processPayment } from '../controllers/paymentController.js'

const ordersRouter = Router()
ordersRouter.post('/', rejectLegacyOrderCreation)
ordersRouter.get('/:orderId', getOrder)
ordersRouter.post('/:orderId/payment', processPayment)
export default ordersRouter

const ordersV2Router = Router()
ordersV2Router.post('/', createOrderV2)
export { ordersV2Router }
