/** Configura Express, CORS y rutas de catálogo, Orders, pagos e identidades; traduce errores a respuestas públicas. */
import cors from 'cors'
import express, { type NextFunction, type Request, type Response } from 'express'

import { ConfigurationError, serverConfig } from './config/env.js'
import productsRouter from './routes/products.js'
import ordersRouter from './routes/orders.js'
import usersRouter from './routes/users.js'
import sessionRouter from './routes/session.js'
import { OrderError } from './domain/orderError.js'
import { OrderPersistenceError } from './domain/orderPersistenceError.js'
import { PaymentPersistenceError } from './domain/paymentPersistenceError.js'
import { UserError } from './domain/userError.js'
import type { ApiErrorResponse } from './types/apiError.js'
import { authorizeRoles } from './middleware/authorization.js'

const app = express()

app.use(
  cors({
    origin: serverConfig.clientOrigin,
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type', 'X-CiberNova-User-Id'],
  }),
)

app.use('/api/products', productsRouter)
app.use('/api/orders', authorizeRoles('B2C'), express.json(), ordersRouter)
app.use('/api/users', usersRouter)
app.use('/api/session', express.json(), sessionRouter)

// Convierte errores de identidad, Orders y del catálogo a sus contratos HTTP sin exponer detalles internos.
app.use(
  (error: unknown, _request: Request, response: Response, _next: NextFunction) => {
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
    if (_request.path === '/api/orders' || _request.path.startsWith('/api/orders/')) {
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

    console.error('Ocurrió un error inesperado al consultar productos.')
    response.status(500).json({ error: 'No se pudo completar la solicitud.' })
  },
)

export default app
