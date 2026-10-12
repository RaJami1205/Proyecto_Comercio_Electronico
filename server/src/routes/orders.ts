import { Router } from 'express'
import { createOrder, getOrder } from '../controllers/orderController.js'

const ordersRouter = Router()
ordersRouter.post('/', createOrder)
ordersRouter.get('/:orderId', getOrder)
export default ordersRouter
