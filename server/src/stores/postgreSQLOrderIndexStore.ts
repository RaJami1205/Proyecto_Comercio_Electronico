/** Revisiones de indexación sobre commerce.orders; nunca modifica snapshots, importes ni estados transaccionales. */
import { randomUUID } from 'node:crypto'
import { database, type Database } from '../db/pool.js'
import { OrderIndexError, type OrderIndexFailure } from '../domain/orderIndexError.js'
import type { OrderIndexSource } from '../types/orderIndex.js'
import { mapOrderRow, rowRecord } from './orderRowMapper.js'

export type OrderIndexClaim =
  | { status: 'claimed'; token: string; source: OrderIndexSource }
  | { status: 'not-found' | 'up-to-date' | 'busy' }

/** source es null cuando el registro persistido no puede mapearse; la sincronización lo reportará como inválido. */
export interface OrderIndexEntry { id: string; indexVersion: number; source: OrderIndexSource | null }

export interface OrderIndexStore {
  /** Toma un lease solo si hay una revisión pendiente y ningún otro proceso la está sincronizando. */
  claim(orderId: string, leaseMs: number): Promise<OrderIndexClaim>
  /** Registra la revisión escrita; pending indica que PostgreSQL ya tiene una revisión posterior. */
  complete(orderId: string, token: string, version: number): Promise<{ pending: boolean }>
  /** Libera el lease y registra una categoría de fallo sanitizada. */
  release(orderId: string, token: string, failure: OrderIndexFailure): Promise<void>
  listPending(afterId: string | undefined, limit: number): Promise<OrderIndexEntry[]>
  listSynced(afterId: string | undefined, limit: number): Promise<Array<{ id: string; indexVersion: number }>>
  /** Relectura autoritativa, sin claims ni cambios, para descartar un avance concurrente legítimo. */
  readVersion(orderId: string): Promise<number | undefined>
  /** Snapshot vigente para verificar toda la proyección, sin tomar lease ni modificar datos. */
  readSource(orderId: string): Promise<OrderIndexSource | undefined>
  /** Vuelve a marcar como pendiente una Order cuya copia en Algolia falta o es anterior. */
  markStale(orderId: string, remoteVersion: number): Promise<boolean>
}

const SQL_TIMEOUT_MS = 2000

function version(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new OrderIndexError('persistence')
  return value
}

/** Combina el DTO validado con la identidad histórica del snapshot de usuario. */
function toSource(row: unknown): OrderIndexSource {
  const record = rowRecord(row)
  const order = mapOrderRow(record)
  const user = rowRecord(record.user_snapshot)
  const company = user.company === undefined ? undefined : rowRecord(user.company)
  return {
    order,
    ownerUserId: String(record.owner_user_id),
    customerRole: String(user.role),
    ...(company ? { company: { id: String(company.id), name: String(company.name) } } : {}),
    indexVersion: version(record.index_version),
  }
}

/** Distingue un registro corrupto de un fallo de PostgreSQL al listar pendientes. */
function toSourceOrNull(row: unknown): OrderIndexSource | null {
  try { return toSource(row) } catch { return null }
}

export class PostgreSQLOrderIndexStore implements OrderIndexStore {
  constructor(private readonly db: Pick<Database, 'transaction'> = database) {}

  /** Cada operación es una sentencia corta en su propia transacción; ningún lock se conserva durante IO con Algolia. */
  private async run(text: string, values: unknown[]): Promise<Record<string, unknown>[]> {
    try {
      return await this.db.transaction(async client => {
        const statement = { text, values, query_timeout: SQL_TIMEOUT_MS }
        return (await client.query<Record<string, unknown>>(statement)).rows
      }, { queryTimeoutMs: SQL_TIMEOUT_MS })
    } catch { throw new OrderIndexError('persistence') }
  }

  async claim(orderId: string, leaseMs: number): Promise<OrderIndexClaim> {
    const token = randomUUID()
    const rows = await this.run(`UPDATE commerce.orders SET index_lease_token = $2,
        index_lease_expires_at = now() + $3::integer * interval '1 millisecond', index_attempted_at = now()
      WHERE id = $1 AND indexed_version < index_version
        AND (index_lease_expires_at IS NULL OR index_lease_expires_at <= now())
      RETURNING *`, [orderId, token, leaseMs])
    if (rows.length === 1) {
      try { return { status: 'claimed', token, source: toSource(rows[0]) } }
      catch {
        await this.release(orderId, token, 'invalid-record')
        throw new OrderIndexError('invalid-record')
      }
    }
    const state = await this.run('SELECT index_version, indexed_version FROM commerce.orders WHERE id = $1', [orderId])
    if (!state.length) return { status: 'not-found' }
    return version(state[0].indexed_version) >= version(state[0].index_version) ? { status: 'up-to-date' } : { status: 'busy' }
  }

  async complete(orderId: string, token: string, indexVersion: number): Promise<{ pending: boolean }> {
    const rows = await this.run(`UPDATE commerce.orders SET indexed_version = $3, index_synced_at = now(),
        index_failure_count = 0, index_last_error = NULL, index_lease_token = NULL, index_lease_expires_at = NULL
      WHERE id = $1 AND index_lease_token = $2 AND indexed_version < $3 AND $3 <= index_version
      RETURNING index_version, indexed_version`, [orderId, token, indexVersion])
    // Sin fila el lease expiró o la revisión ya no aplica: se trata como pendiente para volver a evaluar.
    if (rows.length !== 1) return { pending: true }
    return { pending: version(rows[0].indexed_version) < version(rows[0].index_version) }
  }

  async release(orderId: string, token: string, failure: OrderIndexFailure): Promise<void> {
    await this.run(`UPDATE commerce.orders SET index_failure_count = index_failure_count + 1, index_last_error = $3,
        index_lease_token = NULL, index_lease_expires_at = NULL
      WHERE id = $1 AND index_lease_token = $2`, [orderId, token, failure])
  }

  async listPending(afterId: string | undefined, limit: number): Promise<OrderIndexEntry[]> {
    const rows = await this.run(`SELECT * FROM commerce.orders
      WHERE indexed_version < index_version AND ($1::text IS NULL OR id > $1)
      ORDER BY id LIMIT $2`, [afterId ?? null, limit])
    return rows.map(row => ({ id: String(row.id), indexVersion: version(row.index_version), source: toSourceOrNull(row) }))
  }

  async listSynced(afterId: string | undefined, limit: number): Promise<Array<{ id: string; indexVersion: number }>> {
    const rows = await this.run(`SELECT id, index_version FROM commerce.orders
      WHERE indexed_version = index_version AND ($1::text IS NULL OR id > $1)
      ORDER BY id LIMIT $2`, [afterId ?? null, limit])
    return rows.map(row => ({ id: String(row.id), indexVersion: version(row.index_version) }))
  }

  async readVersion(orderId: string): Promise<number | undefined> {
    const rows = await this.run('SELECT index_version FROM commerce.orders WHERE id = $1', [orderId])
    if (!rows.length) return undefined
    const current = version(rows[0].index_version)
    if (current < 1) throw new OrderIndexError('persistence')
    return current
  }

  async readSource(orderId: string): Promise<OrderIndexSource | undefined> {
    const rows = await this.run('SELECT * FROM commerce.orders WHERE id = $1', [orderId])
    if (!rows.length) return undefined
    try { return toSource(rows[0]) }
    catch { throw new OrderIndexError('invalid-record') }
  }

  async markStale(orderId: string, remoteVersion: number): Promise<boolean> {
    const rows = await this.run(`UPDATE commerce.orders SET indexed_version = $2
      WHERE id = $1 AND indexed_version > $2 RETURNING id`, [orderId, remoteVersion])
    return rows.length === 1
  }
}
