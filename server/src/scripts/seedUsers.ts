/** Valida los usuarios iniciales en dry-run; solo escribe en el índice users con --write y confirmación exacta. */
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

import { collidesWithProductIndex } from '../config/algoliaIndexes.js'
import { findUserSeedErrors } from '../domain/userValidation.js'

const datasetUrl = new URL('../../data/users.json', import.meta.url)

/** Identifica fallos controlados cuyo mensaje puede mostrarse sin revelar detalles del SDK. */
class SeedError extends Error {}

/** Detiene el seed con una muestra acotada de errores antes de cualquier operación externa. */
function validateDataset(value: unknown): asserts value is Record<string, unknown>[] {
  const errors = findUserSeedErrors(value)
  if (errors.length > 0) {
    throw new SeedError(
      `Validación fallida: ${errors.length} errores; network writes = 0. ${errors.slice(0, 10).join('; ')}`,
    )
  }
}

/** Valida argumentos y dataset antes de cargar credentials y ejecutar una escritura explícita. */
async function main() {
  let write = false
  let confirmedIndex: string | undefined
  for (const argument of process.argv.slice(2)) {
    if (argument === '--write' && !write) {
      write = true
    } else if (argument.startsWith('--confirm-index=') && confirmedIndex === undefined) {
      confirmedIndex = argument.slice('--confirm-index='.length)
    } else {
      throw new SeedError('Argumento desconocido o repetido. Use --write y --confirm-index=<value>.')
    }
  }
  if (!write && confirmedIndex !== undefined) {
    throw new SeedError('--confirm-index requiere --write. No se realizaron escrituras.')
  }

  let dataset: unknown
  try {
    dataset = JSON.parse(await readFile(datasetUrl, 'utf8'))
  } catch {
    throw new SeedError('No se pudo leer server/data/users.json como JSON UTF-8.')
  }
  validateDataset(dataset)
  console.log(`Records: ${dataset.length}; validation: PASS; duplicate IDs: 0`)

  if (!write) {
    console.log('Mode: DRY RUN; network writes = 0. No se realizaron requests de red.')
    return
  }

  // Carga credentials solo tras validar y ante una solicitud explícita de escritura.
  const { config } = await import('dotenv')
  config({ path: fileURLToPath(new URL('../../.env', import.meta.url)), quiet: true })
  const appId = process.env.ALGOLIA_APP_ID?.trim()
  const productIndexName = process.env.ALGOLIA_INDEX_NAME?.trim()
  const indexName = process.env.ALGOLIA_USERS_INDEX_NAME?.trim()
  const apiKey = process.env.ALGOLIA_SEED_API_KEY?.trim()

  if (!indexName || confirmedIndex !== indexName) {
    throw new SeedError('Se requiere --confirm-index con el valor exacto de ALGOLIA_USERS_INDEX_NAME. Sin escrituras.')
  }
  if (!productIndexName) throw new SeedError('Falta ALGOLIA_INDEX_NAME para proteger el catálogo. Sin escrituras.')
  if (collidesWithProductIndex(indexName, productIndexName)) {
    throw new SeedError('ALGOLIA_USERS_INDEX_NAME apunta al índice de productos o a sus réplicas. Sin escrituras.')
  }
  if (!appId) throw new SeedError('Falta ALGOLIA_APP_ID. Sin escrituras.')
  if (!apiKey) throw new SeedError('Falta ALGOLIA_SEED_API_KEY. Sin escrituras; no se usa ALGOLIA_API_KEY.')

  const { algoliasearch } = await import('algoliasearch')
  const client = algoliasearch(appId, apiKey)
  try {
    await client.saveObjects({ indexName, objects: dataset, waitForTasks: true })
  } catch {
    // Los errores del SDK pueden incluir detalles de requests; no exponerlos ni imprimir credentials.
    throw new SeedError('Falló la carga en Algolia; puede haber escrituras parciales. Revise el índice antes de reintentar.')
  }
  console.log(`Mode: WRITE; ${dataset.length} records enviados; tareas de indexación completadas.`)
}

main().catch((error: unknown) => {
  console.error(error instanceof SeedError ? error.message : 'Error inesperado del seed; detalles omitidos por seguridad.')
  process.exitCode = 1
})
