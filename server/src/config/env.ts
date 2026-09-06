import 'dotenv/config'

const DEFAULT_PORT = Number(process.env.PORT)
const DEFAULT_CLIENT_ORIGIN = process.env.CLIENT_ORIGIN

export class ConfigurationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ConfigurationError'
  }
}

function resolvePort(value: string | undefined): number {
  const parsedPort = Number(value)

  return Number.isInteger(parsedPort) && parsedPort > 0 ? parsedPort : DEFAULT_PORT
}

export const serverConfig = {
  port: resolvePort(process.env.PORT),
  clientOrigin: process.env.CLIENT_ORIGIN?.trim() || DEFAULT_CLIENT_ORIGIN,
}

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
