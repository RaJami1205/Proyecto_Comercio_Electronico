import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const datasetUrl = new URL('../../data/productos.json', import.meta.url)

class SeedError extends Error {}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isHttpUrl(value: unknown): boolean {
  if (!isNonEmptyString(value)) return false
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

function validateDataset(value: unknown): asserts value is Record<string, unknown>[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new SeedError('Dataset inválido: se requiere un array no vacío.')
  }

  const ids = new Set<string>()
  let duplicateIds = 0
  let errorCount = 0
  const examples: string[] = []

  function invalid(index: number, field: string) {
    errorCount += 1
    if (examples.length < 10) examples.push(`record ${index + 1}: ${field}`)
  }

  value.forEach((record: unknown, index: number) => {
    if (!isObject(record)) {
      invalid(index, 'debe ser un objeto')
      return
    }

    if (!isNonEmptyString(record.objectID)) {
      invalid(index, 'objectID')
    } else if (ids.has(record.objectID)) {
      duplicateIds += 1
      invalid(index, 'objectID duplicado')
    } else {
      ids.add(record.objectID)
    }

    if (!isNonEmptyString(record.title)) invalid(index, 'title')
    if (typeof record.price !== 'number' || !Number.isFinite(record.price) || record.price < 0) {
      invalid(index, 'price')
    }
    if (!Array.isArray(record.categories) || record.categories.length === 0 ||
        !record.categories.every(isNonEmptyString)) {
      invalid(index, 'categories')
    }
    if (!isNonEmptyString(record.brand)) invalid(index, 'brand')

    if (Object.hasOwn(record, 'image_url') && !isHttpUrl(record.image_url)) {
      invalid(index, 'image_url')
    }
    if (Object.hasOwn(record, 'description') && typeof record.description !== 'string') {
      invalid(index, 'description')
    }
    if (Object.hasOwn(record, 'in_stock') && typeof record.in_stock !== 'boolean') {
      invalid(index, 'in_stock')
    }
    if (Object.hasOwn(record, 'stock_quantity') &&
        (typeof record.stock_quantity !== 'number' ||
         !Number.isInteger(record.stock_quantity) || record.stock_quantity < 0)) {
      invalid(index, 'stock_quantity')
    }
    if (Object.hasOwn(record, 'facets') && !isObject(record.facets)) {
      invalid(index, 'facets')
    }
  })

  if (errorCount > 0) {
    throw new SeedError(
      `Validación fallida: ${errorCount} errores; duplicate IDs = ${duplicateIds}; ` +
      `network writes = 0. ${examples.join('; ')}`,
    )
  }
}

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
    throw new SeedError('No se pudo leer server/data/productos.json como JSON UTF-8.')
  }
  validateDataset(dataset)
  console.log(`Records: ${dataset.length}; validation: PASS; duplicate IDs: 0`)

  if (!write) {
    console.log('Mode: DRY RUN; network writes = 0. No se realizaron requests de red.')
    return
  }

  // Load credentials only after validation and only for explicitly requested writes.
  const { config } = await import('dotenv')
  config({ path: fileURLToPath(new URL('../../.env', import.meta.url)), quiet: true })
  const appId = process.env.ALGOLIA_APP_ID?.trim()
  const indexName = process.env.ALGOLIA_INDEX_NAME
  const apiKey = process.env.ALGOLIA_SEED_API_KEY?.trim()

  if (!isNonEmptyString(indexName) || confirmedIndex !== indexName) {
    throw new SeedError('Se requiere --confirm-index con el valor exacto de ALGOLIA_INDEX_NAME. Sin escrituras.')
  }
  if (!appId) throw new SeedError('Falta ALGOLIA_APP_ID. Sin escrituras.')
  if (!apiKey) throw new SeedError('Falta ALGOLIA_SEED_API_KEY. Sin escrituras; no se usa ALGOLIA_API_KEY.')

  const { algoliasearch } = await import('algoliasearch')
  const client = algoliasearch(appId, apiKey)
  try {
    await client.saveObjects({ indexName, objects: dataset, waitForTasks: true })
  } catch {
    // SDK errors can contain request details. Never print them or credentials.
    throw new SeedError('Falló la carga en Algolia; puede haber escrituras parciales. Revise el índice antes de reintentar.')
  }
  console.log(`Mode: WRITE; ${dataset.length} records enviados; tareas de indexación completadas.`)
}

main().catch((error: unknown) => {
  console.error(error instanceof SeedError ? error.message : 'Error inesperado del seed; detalles omitidos por seguridad.')
  process.exitCode = 1
})
