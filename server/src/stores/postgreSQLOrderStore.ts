/** Orders e Idempotency V1 opcionales. Nunca se selecciona por presencia de DATABASE_URL. */
import { randomUUID } from 'node:crypto'
import type { PoolClient, QueryResult, QueryResultRow } from 'pg'
import { database, type Database } from '../db/pool.js'
import { DatabaseError } from '../db/databaseError.js'
import { OrderError } from '../domain/orderError.js'
import { OrderPersistenceError } from '../domain/orderPersistenceError.js'
import { requireCompatible, requireOrderOwner } from '../domain/orderIdentity.js'
import type { Order } from '../types/order.js'
import type { OrderBuilder, OrderCreationContext, OrderStore } from './orderStore.js'
import { mapOrderRow, orderToRow, ORDER_COLUMNS, rowRecord } from './orderRowMapper.js'

export const ORDER_PERSISTENCE_LIMITS = Object.freeze({ operationMs: 8000, sqlMs: 2000, lockMs: 1000 })
type Limits = { operationMs: number; sqlMs: number; lockMs: number }
type Connection = Pick<Database, 'transaction' | 'connect'>

const replaySql = `SELECT r.owner_user_id AS request_owner_id, r.canonical_payload, r.canonical_version, o.*
  FROM commerce.order_creation_requests r JOIN commerce.orders o ON o.id = r.order_id AND o.owner_user_id = r.owner_user_id
  WHERE r.idempotency_key = $1`
const insertSql = `INSERT INTO commerce.orders (${ORDER_COLUMNS.join(', ')})
  VALUES (${ORDER_COLUMNS.map((_, index) => '$' + (index + 1)).join(', ')}) RETURNING *`

export class PostgreSQLOrderStore implements OrderStore {
  private readonly limits: Limits
  constructor(private readonly db: Connection = database, limits: Partial<Limits> = {}) {
    this.limits = { ...ORDER_PERSISTENCE_LIMITS, ...limits }
    if (Object.values(this.limits).some(value => !Number.isSafeInteger(value) || value <= 0 || value > 2147483647)) throw new DatabaseError('configuration')
  }

  /** La composición de Payment debe usar exactamente la misma Database. No abre conexiones. */
  usesDatabase(db: Connection): boolean { return this.db === db }

  /** Operación interna de CN-59: el caller posee la transacción y el client. */
  async readForPayment(client: PoolClient, id: string, ownerId: string, timeoutMs: number, lock = false): Promise<Order | undefined> {
    const statement = { text: 'SELECT * FROM commerce.orders WHERE id = $1 AND owner_user_id = $2' + (lock ? ' FOR UPDATE NOWAIT' : ''),
      values: [id, ownerId], query_timeout: timeoutMs }
    const rows = (await client.query(statement)).rows
    if (!rows.length || rowRecord(rows[0]).owner_user_id !== ownerId) return undefined
    return mapOrderRow(rows[0])
  }

  /** Actualiza únicamente estados con el client prestado; nunca inicia otra transacción. */
  async updateWithClient(client: PoolClient, order: Order, ownerId: string, timeoutMs: number): Promise<Order | undefined> {
    const statement = { text: `UPDATE commerce.orders SET order_status = $1, payment_status = $2, updated_at = $3
      WHERE id = $4 AND owner_user_id = $5 RETURNING *`,
      values: [order.orderStatus, order.paymentStatus, new Date().toISOString(), order.id, ownerId], query_timeout: timeoutMs }
    const rows = (await client.query(statement)).rows
    return rows.length ? mapOrderRow(rows[0]) : undefined
  }

  private remaining(deadline: number): number {
    const value = deadline - Date.now()
    if (value <= 0) throw new OrderPersistenceError()
    return Math.min(value, this.limits.sqlMs)
  }

  private query<Row extends QueryResultRow = Record<string, unknown>>(client: PoolClient, text: string, values: unknown[], deadline: number): Promise<QueryResult<Row>> {
    const statement = { text, values, query_timeout: this.remaining(deadline) }
    return client.query<Row>(statement)
  }

  private replay(row: unknown, ownerId: string, context?: OrderCreationContext): Order {
    const record = rowRecord(row)
    requireOrderOwner(record.request_owner_id, ownerId)
    requireOrderOwner(record.owner_user_id, ownerId)
    if (record.canonical_version !== 1 || typeof record.canonical_payload !== 'string') throw new DatabaseError('transaction')
    if (context) requireCompatible(record.canonical_payload, context.canonicalPayload)
    return mapOrderRow(record)
  }

  /** El timeout solo puede abandonar un builder sin IO de persistencia; sus resultados tardíos no se insertan. */
  private async build(build: OrderBuilder, id: string, deadline: number): Promise<Order> {
    this.remaining(deadline)
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => { const error = new OrderPersistenceError(); controller.abort(error); reject(error) }, Math.max(1, deadline - Date.now()))
      })
      return await Promise.race([Promise.resolve().then(() => build(id, controller.signal)), timeout])
    } finally { clearTimeout(timer) }
  }

  async createOrReplay(context: OrderCreationContext, build: OrderBuilder): Promise<Order> {
    context = structuredClone(context)
    let domainError: OrderError | undefined
    try {
      return await this.db.transaction(async client => {
        const deadline = Date.now() + this.limits.operationMs
        try {
          await this.query(client, 'SET TRANSACTION ISOLATION LEVEL READ COMMITTED', [], deadline)
          await this.query(client, "SELECT set_config('statement_timeout', $1, true), set_config('lock_timeout', $2, true), set_config('idle_in_transaction_session_timeout', $3, true)",
            [this.limits.sqlMs + 'ms', this.limits.lockMs + 'ms', this.limits.operationMs + 'ms'], deadline)
          const id = randomUUID()
          const claim = await this.query(client, `INSERT INTO commerce.order_creation_requests
            (idempotency_key, owner_user_id, canonical_payload, canonical_version, order_id, created_at)
            VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (idempotency_key) DO NOTHING RETURNING order_id`,
            [context.idempotencyKey, context.user.id, context.canonicalPayload, context.canonicalVersion, id, new Date().toISOString()], deadline)
          if (!claim.rows.length) {
            // Debe ser otra sentencia bajo READ COMMITTED para observar al ganador ya confirmado.
            const existing = await this.query(client, replaySql, [context.idempotencyKey], deadline)
            if (existing.rows.length !== 1) throw new DatabaseError('transaction')
            return this.replay(existing.rows[0], context.user.id, context)
          }
          if (claim.rows.length !== 1 || claim.rows[0].order_id !== id) throw new DatabaseError('transaction')
          const order = await this.build(build, id, deadline)
          if (order.id !== id || context.canonicalVersion !== 1 || context.user.role !== 'B2C') throw new DatabaseError('transaction')
          const row = orderToRow(order, context.user)
          const values = ORDER_COLUMNS.map(column => ['user_snapshot', 'buyer_snapshot', 'delivery_snapshot', 'items_snapshot'].includes(column) ? JSON.stringify(row[column]) : row[column])
          const inserted = await this.query(client, insertSql, values, deadline)
          this.remaining(deadline)
          if (inserted.rows.length !== 1) throw new DatabaseError('transaction')
          return mapOrderRow(inserted.rows[0])
        } catch (error) {
          // CN-57 sanitiza errores del callback. Retener solo errores de dominio conocidos para restaurarlos tras rollback.
          if (error instanceof OrderError) domainError = error
          throw error
        }
      }, { queryTimeoutMs: this.limits.sqlMs })
    } catch (error) {
      if (domainError) throw domainError
      if (error instanceof DatabaseError && error.outcome === 'unknown') {
        try {
          const rows = await this.read(replaySql, [context.idempotencyKey], true)
          if (rows.length === 1) return this.replay(rows[0], context.user.id, context)
        } catch (recoveryError) { if (recoveryError instanceof OrderError && !(recoveryError instanceof OrderPersistenceError)) throw recoveryError }
        // Vacío o inaccesible no prueba rollback. No volver a llamar al builder ni cambiar la key.
        throw new OrderPersistenceError('unknown')
      }
      throw new OrderPersistenceError()
    }
  }

  /** Lee con un lease independiente, incluyendo reconciliación explícitamente READ ONLY. */
  private async read(text: string, values: unknown[], readOnly = false): Promise<unknown[]> {
    let client: PoolClient | undefined
    let failure: unknown
    let discard = false
    let rows: unknown[] = []
    const onError = (error: unknown) => { failure ??= error; discard = true }
    try {
      client = await this.db.connect()
      client.on('error', onError)
      const query = (text: string, values: unknown[] = []) => {
        const statement = { text, values, query_timeout: this.limits.sqlMs }
        return client!.query(statement)
      }
      if (readOnly) await query('BEGIN READ ONLY')
      rows = (await query(text, values)).rows
    } catch (error) { failure = error; discard = true }
    finally {
      if (client) {
        if (readOnly) {
          try { const statement = { text: 'ROLLBACK', query_timeout: this.limits.sqlMs }; await client.query(statement) }
          catch (error) { failure ??= error; discard = true }
        }
        try { client.release(discard) } catch (error) { failure ??= error }
        finally { client.off('error', onError) }
      }
    }
    if (failure) throw new OrderPersistenceError()
    return rows
  }

  async findById(id: string): Promise<Order | undefined> {
    try { const rows = await this.read('SELECT * FROM commerce.orders WHERE id = $1', [id]); return rows.length ? mapOrderRow(rows[0]) : undefined }
    catch (error) { if (error instanceof OrderError) throw error; throw new OrderPersistenceError() }
  }

  async findByIdForOwner(id: string, ownerId: string): Promise<Order | undefined> {
    try {
      const rows = await this.read('SELECT * FROM commerce.orders WHERE id = $1 AND owner_user_id = $2', [id, ownerId])
      if (!rows.length || rowRecord(rows[0]).owner_user_id !== ownerId) return undefined
      return mapOrderRow(rows[0])
    }
    catch (error) { if (error instanceof OrderError) throw error; throw new OrderPersistenceError() }
  }

  async findByIdempotencyKey(key: string, ownerId: string): Promise<Order | undefined> {
    try { const rows = await this.read(replaySql, [key]); return rows.length ? this.replay(rows[0], ownerId) : undefined }
    catch (error) { if (error instanceof OrderError) throw error; throw new OrderPersistenceError() }
  }

  /** Solo estados y updated_at. Attempts/locks/recovery de Payment pertenecen a CN-59. */
  async update(order: Order, ownerId: string): Promise<Order | undefined> {
    try {
      return await this.db.transaction(client => this.updateWithClient(client, order, ownerId, this.limits.sqlMs), { queryTimeoutMs: this.limits.sqlMs })
    } catch (error) { throw new OrderPersistenceError(error instanceof DatabaseError && error.outcome === 'unknown' ? 'unknown' : 'not-committed') }
  }
}
