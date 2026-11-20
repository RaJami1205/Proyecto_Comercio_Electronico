/** Resuelve configuración server-side y valida la presencia de credentials de Algolia sin exponer sus valores. */
import 'dotenv/config'

import { collidesWithProductIndex } from './algoliaIndexes.js'

const DEFAULT_PORT = Number(process.env.PORT)
const DEFAULT_CLIENT_ORIGIN = process.env.CLIENT_ORIGIN

/** Distingue una configuración incompleta de otros fallos para responder con servicio no disponible. */
export class ConfigurationError extends Error {
  /** Crea un error de configuración con el mensaje recibido para distinguirlo de errores inesperados. */
  constructor(message: string) {
    super(message)
    this.name = 'ConfigurationError'
  }
}

/** Acepta un puerto entero positivo o utiliza el valor base configurado. */
function resolvePort(value: string | undefined): number {
  const parsedPort = Number(value)

  return Number.isInteger(parsedPort) && parsedPort > 0 ? parsedPort : DEFAULT_PORT
}

const commerceStoreMode = process.env.COMMERCE_STORE_MODE?.trim() || 'memory'
if (commerceStoreMode !== 'memory' && commerceStoreMode !== 'postgresql') {
  throw new ConfigurationError('COMMERCE_STORE_MODE debe ser memory o postgresql.')
}

// El corte de Checkout es independiente del almacenamiento y solo se configura en Server.
const orderCreationMode = process.env.ORDER_CREATION_MODE?.trim() || 'v1-compatible'
if (orderCreationMode !== 'v1-compatible' && orderCreationMode !== 'v2-only') {
  throw new ConfigurationError('ORDER_CREATION_MODE debe ser v1-compatible o v2-only.')
}

export const serverConfig = {
  commerceStoreMode,
  orderCreationMode,
  // Opt-in: una pasada acotada de Reconciliation al iniciar recupera revisiones pendientes tras un reinicio.
  ordersIndexReconcileOnStart: process.env.ALGOLIA_ORDERS_RECONCILE_ON_START?.trim() === 'true',
  port: resolvePort(process.env.PORT),
  clientOrigin: process.env.CLIENT_ORIGIN?.trim() || DEFAULT_CLIENT_ORIGIN,
}

/** Exige las variables de Algolia antes de habilitar una consulta del service. */
export function getAlgoliaConfig() {
  const appId = process.env.ALGOLIA_APP_ID?.trim()
  const apiKey = process.env.ALGOLIA_API_KEY?.trim()
  const indexName = process.env.ALGOLIA_INDEX_NAME?.trim()
  const missingVariables = [
    !appId && 'ALGOLIA_APP_ID',
    !apiKey && 'ALGOLIA_API_KEY',
    !indexName && 'ALGOLIA_INDEX_NAME',
  ].filter(Boolean)

  if (!appId || !apiKey || !indexName) {
    throw new ConfigurationError(
      `Faltan variables de entorno del servidor: ${missingVariables.join(', ')}.`,
    )
  }

  return { appId, apiKey, indexName }
}

/** Exige el índice users por separado para que su ausencia no afecte las consultas del catálogo. */
export function getAlgoliaUsersConfig() {
  const { indexName: productIndexName } = getAlgoliaConfig()
  const indexName = process.env.ALGOLIA_USERS_INDEX_NAME?.trim()

  if (!indexName) {
    throw new ConfigurationError('Faltan variables de entorno del servidor: ALGOLIA_USERS_INDEX_NAME.')
  }
  if (collidesWithProductIndex(indexName, productIndexName)) {
    throw new ConfigurationError('ALGOLIA_USERS_INDEX_NAME no puede apuntar al índice de productos ni a sus réplicas.')
  }

  return { indexName }
}

/** Presencia de nombre y clave del índice orders; sin ellos la proyección queda pendiente en PostgreSQL. */
export function isAlgoliaOrdersIndexConfigured(): boolean {
  return Boolean(process.env.ALGOLIA_ORDERS_INDEX_NAME?.trim() && process.env.ALGOLIA_ORDERS_API_KEY?.trim())
}

/** Índice orders con clave propia, separada del catálogo, users y de credenciales administrativas. */
export function getAlgoliaOrdersConfig() {
  const { appId, indexName: productIndexName } = getAlgoliaConfig()
  const indexName = process.env.ALGOLIA_ORDERS_INDEX_NAME?.trim()
  const apiKey = process.env.ALGOLIA_ORDERS_API_KEY?.trim()
  const missingVariables = [!indexName && 'ALGOLIA_ORDERS_INDEX_NAME', !apiKey && 'ALGOLIA_ORDERS_API_KEY'].filter(Boolean)

  if (!indexName || !apiKey) {
    throw new ConfigurationError(`Faltan variables de entorno del servidor: ${missingVariables.join(', ')}.`)
  }
  if (collidesWithProductIndex(indexName, productIndexName) || indexName === process.env.ALGOLIA_USERS_INDEX_NAME?.trim()) {
    throw new ConfigurationError('ALGOLIA_ORDERS_INDEX_NAME no puede apuntar a los índices de productos, sus réplicas ni users.')
  }

  return { appId, apiKey, indexName }
}
