/**
 * Indexación inicial, Reconciliation y verificación del índice Algolia orders desde PostgreSQL.
 * Por defecto es dry-run: valida los registros pendientes sin escribir en Algolia ni en PostgreSQL.
 */
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'

/** Identifica fallos controlados cuyo mensaje puede mostrarse sin revelar detalles internos. */
class SyncError extends Error {}

interface Options { write: boolean; confirmedIndex?: string; verifyRemote: boolean; configureSettings: boolean; limit: number }

/** Rechaza opciones desconocidas o repetidas antes de leer configuración o abrir conexiones. */
function parseArguments(argumentsList: string[]): Options {
  const options: Options = { write: false, verifyRemote: false, configureSettings: false, limit: 500 }
  const seen = new Set<string>()
  for (const argument of argumentsList) {
    const name = argument.split('=')[0]
    if (seen.has(name)) throw new SyncError('Argumento repetido. No se realizaron escrituras.')
    seen.add(name)
    if (argument === '--write') options.write = true
    else if (argument === '--verify-remote') options.verifyRemote = true
    else if (argument === '--configure-settings') options.configureSettings = true
    else if (argument.startsWith('--confirm-index=')) options.confirmedIndex = argument.slice('--confirm-index='.length)
    else if (argument.startsWith('--limit=')) {
      const limit = Number(argument.slice('--limit='.length))
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100000) throw new SyncError('--limit debe ser un entero entre 1 y 100000.')
      options.limit = limit
    } else throw new SyncError('Argumento desconocido. Use --write, --confirm-index=<value>, --verify-remote, --configure-settings o --limit=<n>.')
  }
  if (!options.write && options.confirmedIndex !== undefined) throw new SyncError('--confirm-index requiere --write. No se realizaron escrituras.')
  if (options.write && !options.confirmedIndex) throw new SyncError('--write requiere --confirm-index=<ALGOLIA_ORDERS_INDEX_NAME>. No se realizaron escrituras.')
  if (options.configureSettings && options.verifyRemote) throw new SyncError('--configure-settings no se combina con --verify-remote.')
  return options
}

async function main() {
  const options = parseArguments(process.argv.slice(2))
  const { ORDER_INDEX_SETTINGS } = await import('../domain/orderIndexQuery.js')

  if (options.configureSettings && !options.write) {
    console.log(`Settings propuestos para el índice orders:\n${JSON.stringify(ORDER_INDEX_SETTINGS, null, 2)}`)
    console.log('Mode: DRY RUN; Algolia requests = 0.')
    return
  }

  // Carga la ruta explícita o, en mantenimiento manual, server/.env. El import posterior de dotenv/config
  // debe usar la misma ruta y no intentar además el .env del directorio de trabajo.
  const environmentPath = resolve(process.env.DOTENV_CONFIG_PATH ?? fileURLToPath(new URL('../../.env', import.meta.url)))
  process.env.DOTENV_CONFIG_PATH = environmentPath
  const { config } = await import('dotenv')
  config({ path: environmentPath, quiet: true })
  const { getAlgoliaOrdersConfig } = await import('../config/env.js')

  let indexName: string | undefined
  if (options.write || options.verifyRemote) {
    try { indexName = getAlgoliaOrdersConfig().indexName }
    catch { throw new SyncError('La configuración del índice orders es inválida o incompleta. Sin escrituras.') }
    if (options.write && options.confirmedIndex !== indexName) {
      throw new SyncError('--confirm-index no coincide exactamente con ALGOLIA_ORDERS_INDEX_NAME. Sin escrituras.')
    }
  }

  if (options.configureSettings) {
    const apiKey = process.env.ALGOLIA_ORDERS_SETTINGS_API_KEY?.trim()
    const appId = process.env.ALGOLIA_APP_ID?.trim()
    if (!apiKey || !appId || !indexName) throw new SyncError('Falta ALGOLIA_ORDERS_SETTINGS_API_KEY. Sin escrituras.')
    const { algoliasearch } = await import('algoliasearch')
    const client = algoliasearch(appId, apiKey)
    try {
      const response = await client.setSettings({ indexName, indexSettings: { ...ORDER_INDEX_SETTINGS,
        searchableAttributes: [...ORDER_INDEX_SETTINGS.searchableAttributes],
        attributesForFaceting: [...ORDER_INDEX_SETTINGS.attributesForFaceting],
        customRanking: [...ORDER_INDEX_SETTINGS.customRanking] } })
      await client.waitForTask({ indexName, taskID: response.taskID })
    } catch { throw new SyncError('Algolia rechazó o no completó la configuración del índice orders.') }
    console.log('Mode: WRITE; settings del índice orders aplicados.')
    return
  }

  const { Database } = await import('../db/pool.js')
  const { PostgreSQLOrderIndexStore } = await import('../stores/postgreSQLOrderIndexStore.js')
  const { createAlgoliaOrderIndexWriter, OrderIndexSyncService } = await import('../services/orderIndexSyncService.js')
  const database = new Database()
  // El dry-run sin --verify-remote nunca crea un cliente Algolia.
  const unusedWriter = { save: async () => { throw new SyncError('Escritura no autorizada.') },
    readRecords: async () => new Map<string, Record<string, unknown>>(), readVersions: async () => new Map<string, number>() }
  const service = new OrderIndexSyncService(new PostgreSQLOrderIndexStore(database),
    options.write || options.verifyRemote ? createAlgoliaOrderIndexWriter() : unusedWriter,
    { log: message => console.error(message.replace(/Order \S+/, 'Order')) })

  try {
    if (options.verifyRemote) {
      const report = await service.verifyRemote({ limit: options.limit, dryRun: !options.write })
      console.log(`Verificadas: ${report.checked}; ausentes u obsoletas: ${report.drift}; reparadas: ${report.repaired}; fallidas: ${report.failed}.`)
      console.log(options.write ? 'Mode: WRITE.' : 'Mode: DRY RUN; Algolia writes = 0; PostgreSQL writes = 0.')
      if (report.failed > 0) process.exitCode = 1
      return
    }
    const report = await service.reconcile({ limit: options.limit, dryRun: !options.write })
    console.log(`Pendientes: ${report.pending}; válidas: ${report.valid}; inválidas: ${report.invalid}; ` +
      `sincronizadas: ${report.synced}; fallidas: ${report.failed}; omitidas: ${report.skipped}.`)
    console.log(options.write ? 'Mode: WRITE.' : 'Mode: DRY RUN; Algolia requests = 0; PostgreSQL writes = 0.')
    if (report.failed > 0 || report.invalid > 0) process.exitCode = 1
  } finally {
    await database.close().catch(() => undefined)
  }
}

main().catch((error: unknown) => {
  const known = error instanceof SyncError || (error instanceof Error && error.name === 'OrderIndexError')
  console.error(known ? error.message : 'Error inesperado de la sincronización; detalles omitidos por seguridad.')
  process.exitCode = 1
})
