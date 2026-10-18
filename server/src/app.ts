/** Configura Express, CORS y rutas de catálogo, Orders y pagos; traduce errores a respuestas públicas. */
import cors from 'cors'
import express, { type NextFunction, type Request, type Response } from 'express'

import { ConfigurationError, serverConfig } from './config/env.js'
import productsRouter from './routes/products.js'
import ordersRouter from './routes/orders.js'
import { OrderError } from './domain/orderError.js'
import type { ApiErrorResponse } from './types/apiError.js'

const app = express()

app.use(
  cors({
    origin: serverConfig.clientOrigin,
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type'],
  }),
)

app.use('/api/products', productsRouter)
app.use('/api/orders', express.json(), ordersRouter)

// Convierte errores de Orders y del catálogo a sus contratos HTTP sin exponer detalles internos.
app.use(
  (error: unknown, _request: Request, response: Response, _next: NextFunction) => {
    if (_request.path === '/api/orders' || _request.path.startsWith('/api/orders/')) {
      let status = 500
      let body: ApiErrorResponse = { error: { code: 'UNEXPECTED_ERROR', message: 'No se pudo completar la solicitud.' } }
      if (error instanceof OrderError) {
        status = error.status
        body = { error: { code: error.code, message: error.message, ...(error.fieldErrors ? { fieldErrors: error.fieldErrors } : {}) } }
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
