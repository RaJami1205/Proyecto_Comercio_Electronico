/** Asocia las rutas de creación, consulta y pago de Orders con sus controladores y permisos RBAC. */
import express, { Router } from 'express'
import { createOrder, createOrderV2, getOrder } from '../controllers/orderController.js'
import { processPayment } from '../controllers/paymentController.js'
import { requirePermissions } from '../middleware/authorization.js'

/**
 * Rutas legacy, montadas solo para B2C/B2B. Compatibilidad explícita del CN-63:
 * la consulta individual se limita al propietario y ADMIN debe usar GET /api/v2/orders/:orderId.
 */
const ordersRouter = Router()
ordersRouter.post('/', createOrder)
ordersRouter.get('/:orderId', requirePermissions('orders:read:own'), getOrder)
ordersRouter.post('/:orderId/payment', requirePermissions('checkout:create'), processPayment)
export default ordersRouter

/** Rutas V2: la identidad se resuelve una vez y cada operación exige su permiso. */
const ordersV2Router = Router()
ordersV2Router.post('/', requirePermissions('checkout:create'), express.json(), createOrderV2)
ordersV2Router.get('/:orderId', requirePermissions('orders:read:own', 'orders:read:all'), getOrder)
export { ordersV2Router }
