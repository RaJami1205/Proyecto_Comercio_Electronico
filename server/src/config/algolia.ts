import { algoliasearch } from 'algoliasearch'

import { getAlgoliaConfig } from './env.js'

let client: ReturnType<typeof algoliasearch> | null = null

export function getAlgoliaClient() {
  if (!client) {
    const { appId, apiKey } = getAlgoliaConfig()
    client = algoliasearch(appId, apiKey)
  }

  return client
}
