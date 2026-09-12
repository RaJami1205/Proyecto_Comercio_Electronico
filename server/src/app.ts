import cors from 'cors'
import express, { type NextFunction, type Request, type Response } from 'express'

import { ConfigurationError, serverConfig } from './config/env.js'
import productsRouter from './routes/products.js'

const app = express()

app.use(
  cors({
    origin: serverConfig.clientOrigin,
    methods: ['GET'],
    allowedHeaders: ['Content-Type'],
  }),
)

app.use('/api/products', productsRouter)

app.use(
  (error: unknown, _request: Request, response: Response, _next: NextFunction) => {
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
