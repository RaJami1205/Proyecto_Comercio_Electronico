/** Chequeo manual READ-ONLY. Importar este módulo no carga .env ni ejecuta consultas. */
import type { PoolClient, PoolConfig } from 'pg'
import { resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { getDatabaseConfig } from '../config/database.js'
import { Database } from '../db/pool.js'
import { DatabaseError, databaseError, isConnectionFailure } from '../db/databaseError.js'

/** Reutiliza la configuración runtime con TLS estricto y limita este proceso manual a un client. */
export function getSmokeTestConfig(environment: Parameters<typeof getDatabaseConfig>[0] = process.env): PoolConfig {
  const configuration = getDatabaseConfig(environment)
  if (typeof configuration.ssl !== 'object' || configuration.ssl?.rejectUnauthorized !== true) {
    throw new DatabaseError('configuration')
  }
  return { ...configuration, max: 1 }
}

/** Usa SQL fijo en un solo client y siempre intenta ROLLBACK, release y close. No reintenta consultas. */
export async function runDatabaseSmokeTest(database: Pick<Database, 'connect' | 'close'>): Promise<void> {
  let client: PoolClient | undefined
  let began = false
  let discard = false
  let failure: DatabaseError | undefined
  const onClientError = (error: unknown) => {
    discard = true
    failure ??= databaseError(error, 'not-committed', 'unavailable')
  }
  try {
    client = await database.connect()
    client.on('error', onClientError)
    await client.query('BEGIN READ ONLY')
    began = true
    const result = await client.query<{ current_user: unknown; current_database: unknown; transaction_read_only: unknown }>(
      "SELECT current_user, current_database(), current_setting('transaction_read_only') AS transaction_read_only",
    )
    if (result.rows.length !== 1 || result.rows[0].current_user !== 'cibernova_app'
      || result.rows[0].transaction_read_only !== 'on') throw new DatabaseError('configuration')
    if (failure) throw failure
    // Cero filas también confirma que el rol puede consultar la tabla, sin leer datos comerciales.
    await client.query('SELECT 1 AS access_ok FROM commerce.orders LIMIT 1')
  } catch (error) {
    failure = databaseError(error, 'not-committed', 'unavailable')
    discard = discard || !began || isConnectionFailure(error)
  } finally {
    if (client) {
      try { await client.query('ROLLBACK') }
      catch (error) { failure ??= databaseError(error); discard = true }
      try { client.release(discard) }
      catch (error) { failure ??= databaseError(error) }
      finally { client.off('error', onClientError) }
    }
    try { await database.close() }
    catch (error) { failure ??= databaseError(error, 'not-committed', 'unavailable') }
  }
  if (failure) throw failure
}

/** Entry point explícito, independiente de Express, seeds y suites de integración. */
async function main(): Promise<void> {
  if (process.argv.length > 2) throw new DatabaseError('configuration')
  const { config } = await import('dotenv')
  config({ path: fileURLToPath(new URL('../../.env', import.meta.url)), quiet: true })
  const database = new Database(getSmokeTestConfig)
  await runDatabaseSmokeTest(database)
  console.log('Database Connectivity Smoke Test: PASS. Runtime cibernova_app, READ ONLY on, commerce.orders accesible.')
}

// Un import (incluido desde tests con mocks) no entra al comando manual ni lee el entorno privado.
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  void main().catch((error: unknown) => {
    console.error(`Database Connectivity Smoke Test: FAIL. ${databaseError(error).message}`)
    process.exitCode = 1
  })
}
