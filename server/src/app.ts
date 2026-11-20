/** Configura Express, CORS y rutas de catálogo, Orders, pagos e identidades; traduce errores a respuestas públicas. */
import cors from 'cors'
import express, { type NextFunction, type Request, type Response } from 'express'

import { ConfigurationError, serverConfig } from './config/env.js'
import productsRouter from './routes/products.js'
import ordersRouter, { ordersV2Router } from './routes/orders.js'
import usersRouter from './routes/users.js'
import sessionRouter from './routes/session.js'
import branchesRouter from './routes/branches.js'
import adminProductsRouter from './routes/adminProducts.js'
import adminOrdersRouter from './routes/adminOrders.js'
import { CatalogError } from './domain/catalogError.js'
import { OrderError } from './domain/orderError.js'
import { OrderPersistenceError } from './domain/orderPersistenceError.js'
import { PaymentPersistenceError } from './domain/paymentPersistenceError.js'
import { UserError } from './domain/userError.js'
import type { ApiErrorResponse } from './types/apiError.js'
import { authorizeIdentity, authorizeRoles } from './middleware/authorization.js'

const app = express()

app.use(
  cors({
    origin: serverConfig.clientOrigin,
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type', 'X-CiberNova-User-Id', 'X-CiberNova-Guest-Id'],
  }),
)

app.use('/api/products', productsRouter)
app.use('/api/branches', branchesRouter)
app.use('/api/orders', authorizeRoles('B2C', 'B2B'), express.json(), ordersRouter)
app.use('/api/v2/orders', authorizeIdentity(), ordersV2Router)
app.use('/api/v2/admin/products', authorizeIdentity(), adminProductsRouter)
app.use('/api/v2/admin/orders', authorizeIdentity(), adminOrdersRouter)
app.use('/api/users', usersRouter)
app.use('/api/session', express.json(), sessionRouter)

// Convierte errores de identidad, Orders y del catálogo a sus contratos HTTP sin exponer detalles internos.
app.use(
  (error: unknown, _request: Request, response: Response, _next: NextFunction) => {
    if (_request.path === '/api/v2/admin/products' || _request.path.startsWith('/api/v2/admin/products/')) {
      let body: ApiErrorResponse = { error: { code: 'CATALOG_UNAVAILABLE', message: 'El catálogo no está disponible en este momento.' } }
      let status = 503
      if (error instanceof UserError || error instanceof CatalogError) {
        status = error.status
        body = { error: { code: error.code, message: error.message } }
      } else if (!(error instanceof ConfigurationError)) {
        // Fallos de Algolia u otros inesperados: sin detalles del SDK ni de la configuración.
        console.error('No se pudo completar la consulta administrativa de productos.')
      }
      response.status(status).json(body)
      return
    }
    if (_request.path.startsWith('/api/users') || _request.path.startsWith('/api/session')) {
      let status = 500
      let body: ApiErrorResponse = { error: { code: 'UNEXPECTED_ERROR', message: 'No se pudo completar la solicitud.' } }
      if (error instanceof UserError) {
        status = error.status
        body = { error: { code: error.code, message: error.message } }
      } else if (error !== null && typeof error === 'object' && 'type' in error && (error.type === 'entity.parse.failed' || error.type === 'entity.too.large')) {
        status = error.type === 'entity.too.large' ? 413 : 400
        body = { error: { code: 'INVALID_USER_ID', message: 'El cuerpo de la solicitud no es válido.' } }
      }
      response.status(status).json(body)
      return
    }
    if (_request.path === '/api/orders' || _request.path.startsWith('/api/orders/')
      || _request.path === '/api/v2/orders' || _request.path.startsWith('/api/v2/orders/')
      || _request.path === '/api/v2/admin/orders' || _request.path.startsWith('/api/v2/admin/orders/')) {
      let status = 500
      let body: ApiErrorResponse = { error: { code: 'UNEXPECTED_ERROR', message: 'No se pudo completar la solicitud.' } }
      if (error instanceof OrderError || error instanceof UserError) {
        status = error.status
        body = { error: { code: error.code, message: error.message,
          ...(error instanceof OrderError && error.fieldErrors ? { fieldErrors: error.fieldErrors } : {}),
          ...((error instanceof OrderPersistenceError || error instanceof PaymentPersistenceError) && error.outcome === 'unknown' ? { outcome: 'unknown' as const } : {}) } }
      } else if (error instanceof ConfigurationError) {
        status = 503
        body.error.message = 'El servicio de catálogo no está disponible.'
      } else if (error !== null && typeof error === 'object' && 'type' in error && (error.type === 'entity.parse.failed' || error.type === 'entity.too.large')) {
        status = error.type === 'entity.too.large' ? 413 : 400
        body = { error: { code: 'CHECKOUT_VALIDATION_ERROR', message: 'El cuerpo de la solicitud no es válido.' } }
      }
      response.status(status).json(body)
      return
    }
    if (error instanceof ConfigurationError) {
      console.error(error.message)
      response.status(503).json({ error: 'El servicio de productos no está configurado.' })
      return
    }
    if (error instanceof UserError || error instanceof CatalogError) {
      response.status(error.status).json({ error: { code: error.code, message: error.message } })
      return
    }

    console.error('Ocurrió un error inesperado al consultar productos.')
    response.status(500).json({ error: 'No se pudo completar la solicitud.' })
  },
)

export default app
