/**
 * Ruta administrativa Read-Only de Orders (CN-66): la identidad se resuelve en app.ts y aquí se exige orders:read:all.
 * El detalle reutiliza GET /api/v2/orders/:orderId, que ya autoriza a ADMIN con el mismo permiso.
 */
import { Router } from 'express'
import { listAdminOrders } from '../controllers/adminOrderController.js'
import { requirePermissions } from '../middleware/authorization.js'

// Solo GET: ADMIN no crea, paga, cambia estados ni elimina Orders desde este módulo.
const adminOrdersRouter = Router()
adminOrdersRouter.get('/', requirePermissions('orders:read:all'), listAdminOrders)
export default adminOrdersRouter
