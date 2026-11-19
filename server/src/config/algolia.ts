/** Provee los clientes Algolia compartidos exclusivamente para las capas del server. */
import { algoliasearch } from 'algoliasearch'

import { getAlgoliaConfig, getAlgoliaOrdersConfig } from './env.js'

let client: ReturnType<typeof algoliasearch> | null = null
let ordersClient: ReturnType<typeof algoliasearch> | null = null

/** Inicializa el cliente de forma diferida y reutiliza la instancia con credentials server-side. */
export function getAlgoliaClient() {
  if (!client) {
    const { appId, apiKey } = getAlgoliaConfig()
    client = algoliasearch(appId, apiKey)
  }

  return client
}

/** Cliente separado con la clave restringida al índice orders; nunca reutiliza la clave del catálogo. */
export function getAlgoliaOrdersClient() {
  if (!ordersClient) {
    const { appId, apiKey } = getAlgoliaOrdersConfig()
    // Timeouts acotados: la sincronización corre fuera de la respuesta HTTP y se reintenta desde PostgreSQL.
    ordersClient = algoliasearch(appId, apiKey, { timeouts: { connect: 2000, read: 5000, write: 10000 } })
  }

  return ordersClient
}
