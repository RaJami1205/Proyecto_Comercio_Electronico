/** Provee el cliente Algolia compartido exclusivamente para las capas del server. */
import { algoliasearch } from 'algoliasearch'

import { getAlgoliaConfig } from './env.js'

let client: ReturnType<typeof algoliasearch> | null = null

/** Inicializa el cliente de forma diferida y reutiliza la instancia con credentials server-side. */
export function getAlgoliaClient() {
  if (!client) {
    const { appId, apiKey } = getAlgoliaConfig()
    client = algoliasearch(appId, apiKey)
  }

  return client
}
