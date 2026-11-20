/** Rutas administrativas Read-Only (CN-67): la identidad se resuelve en app.ts y aquí se exige el permiso RBAC. */
import { Router } from 'express'
import { getAdminProductHandler, listAdminProductsHandler } from '../controllers/adminProductController.js'
import { requirePermissions } from '../middleware/authorization.js'

// Solo GET: esta Story no expone operaciones de escritura sobre productos, precios ni inventario.
const adminProductsRouter = Router()
adminProductsRouter.get('/', requirePermissions('catalog:read:admin'), listAdminProductsHandler)
adminProductsRouter.get('/:productId', requirePermissions('catalog:read:admin'), getAdminProductHandler)
export default adminProductsRouter
