/** Ejecuta transacciones sobre un único PoolClient y conserva la incertidumbre si se pierde la confirmación de COMMIT. */
import type { Pool, PoolClient } from 'pg'
import { DatabaseError, databaseError, isConnectionFailure, sqlStateOf } from './databaseError.js'

export interface TransactionOptions { queryTimeoutMs?: number }

/** El callback utiliza el client recibido. Este helper posee BEGIN/COMMIT/ROLLBACK/release y nunca reintenta el callback. */
export async function withTransaction<T>(pool: Pick<Pool, 'connect'>, operation: (client: PoolClient) => Promise<T>, options: TransactionOptions = {}): Promise<T> {
  if (options.queryTimeoutMs !== undefined && (!Number.isSafeInteger(options.queryTimeoutMs) || options.queryTimeoutMs <= 0 || options.queryTimeoutMs > 2147483647)) throw new DatabaseError('configuration')
  let client: PoolClient
  try { client = await pool.connect() } catch (error) { throw databaseError(error, 'not-committed', 'unavailable') }
  let began = false
  let committing = false
  let discard = false
  let connectionError: unknown
  const onError = (error: unknown) => { connectionError = error; discard = true }
  client.on?.('error', onError)
  const control = (text: string) => {
    if (options.queryTimeoutMs === undefined) return client.query(text)
    // pg soporta query_timeout por consulta; @types/pg lo declara solo en ClientConfig.
    const statement = { text, query_timeout: options.queryTimeoutMs }
    return client.query(statement)
  }
  try {
    await control('BEGIN')
    began = true
    const result = await operation(client)
    if (connectionError !== undefined) throw connectionError
    committing = true
    const commit = await control('COMMIT')
    // PostgreSQL puede responder ROLLBACK si el callback ocultó un error SQL que abortó la transacción.
    if (commit.command !== 'COMMIT') throw new DatabaseError('transaction', 'rolled-back')
    return result
  } catch (error) {
    const code = sqlStateOf(error)
    const rejected = (code !== undefined && code !== '40003' && !isConnectionFailure(error))
      || (error instanceof DatabaseError && error.outcome === 'rolled-back')
    const uncertain = committing && !rejected
    discard = discard || !began || isConnectionFailure(error) || uncertain
    let outcome: 'not-committed' | 'rolled-back' = 'not-committed'
    if (began) {
      try { await control('ROLLBACK'); outcome = 'rolled-back' } catch { discard = true }
    }
    if (uncertain) throw new DatabaseError('uncertain-commit', 'unknown')
    throw databaseError(error, outcome)
  } finally {
    try { client.release(discard) }
    finally { client.off?.('error', onError) }
  }
}
