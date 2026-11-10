/** Ejecuta transacciones sobre un único PoolClient y conserva la incertidumbre si se pierde la confirmación de COMMIT. */
import type { Pool, PoolClient } from 'pg'
import { DatabaseError, databaseError, isConnectionFailure, sqlStateOf } from './databaseError.js'

/** El callback utiliza el client recibido. Este helper posee BEGIN/COMMIT/ROLLBACK/release y nunca reintenta el callback. */
export async function withTransaction<T>(pool: Pick<Pool, 'connect'>, operation: (client: PoolClient) => Promise<T>): Promise<T> {
  let client: PoolClient
  try { client = await pool.connect() } catch (error) { throw databaseError(error, 'not-committed', 'unavailable') }
  let began = false
  let committing = false
  let discard = false
  try {
    await client.query('BEGIN')
    began = true
    const result = await operation(client)
    committing = true
    const commit = await client.query('COMMIT')
    // PostgreSQL puede responder ROLLBACK si el callback ocultó un error SQL que abortó la transacción.
    if (commit.command !== 'COMMIT') throw new DatabaseError('transaction', 'rolled-back')
    return result
  } catch (error) {
    const code = sqlStateOf(error)
    const rejected = (code !== undefined && code !== '40003' && !isConnectionFailure(error))
      || (error instanceof DatabaseError && error.outcome === 'rolled-back')
    const uncertain = committing && !rejected
    discard = !began || isConnectionFailure(error) || uncertain
    let outcome: 'not-committed' | 'rolled-back' = 'not-committed'
    if (began) {
      try { await client.query('ROLLBACK'); outcome = 'rolled-back' } catch { discard = true }
    }
    if (uncertain) throw new DatabaseError('uncertain-commit', 'unknown')
    throw databaseError(error, outcome)
  } finally {
    client.release(discard)
  }
}
