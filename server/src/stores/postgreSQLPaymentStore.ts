/** Payment V1 durable. Exclusión por Order; Attempt y estados se confirman con un único client. */
import type { PoolClient } from 'pg'
import { DatabaseError, sqlStateOf } from '../db/databaseError.js'
import type { Database } from '../db/pool.js'
import { OrderError } from '../domain/orderError.js'
import { PaymentPersistenceError, paymentPersistenceError } from '../domain/paymentPersistenceError.js'
import type { PaymentResult } from '../types/payment.js'
import type { OrderStore } from './orderStore.js'
import { mapPaymentRow } from './paymentRowMapper.js'
import { missingOrder, paymentInProgress, type PaymentAttempt, type PaymentBuilder, type PaymentContext, type PaymentStore } from './paymentStore.js'
import { PostgreSQLOrderStore } from './postgreSQLOrderStore.js'

type Connection = Pick<Database, 'connect' | 'transaction'>
type Limits = { operationMs: number; sqlMs: number; lockMs: number }
export const PAYMENT_PERSISTENCE_LIMITS = Object.freeze({ operationMs: 8000, sqlMs: 2000, lockMs: 1000 })

export class PostgreSQLPaymentStore implements PaymentStore {
  private readonly limits: Limits
  constructor(private readonly orders: PostgreSQLOrderStore, private readonly db: Connection, limits: Partial<Limits> = {}) {
    this.limits = { ...PAYMENT_PERSISTENCE_LIMITS, ...limits }
    if (!(orders instanceof PostgreSQLOrderStore) || !orders.usesDatabase(db)
      || Object.values(this.limits).some(value => !Number.isSafeInteger(value) || value <= 0 || value > 2147483647)) throw new DatabaseError('configuration')
  }
  isFor(orders: OrderStore): boolean { return orders === this.orders && this.orders.usesDatabase(this.db) }
  private remaining(deadline: number): number {
    const value = deadline - Date.now()
    if (value <= 0) throw new PaymentPersistenceError('timeout')
    return Math.min(value, this.limits.sqlMs)
  }
  private query(client: PoolClient, text: string, values: unknown[], deadline: number) {
    const statement = { text, values, query_timeout: this.remaining(deadline) }
    return client.query<Record<string, unknown>>(statement)
  }
  private async build(build: PaymentBuilder, order: Parameters<PaymentBuilder>[0], deadline: number): Promise<PaymentResult> {
    this.remaining(deadline)
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      return await Promise.race([Promise.resolve().then(() => build(structuredClone(order))), new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new PaymentPersistenceError('timeout')), Math.max(1, deadline - Date.now()))
      })])
    } finally { clearTimeout(timer) }
  }

  async processOrReplay(context: PaymentContext, build: PaymentBuilder): Promise<PaymentResult> {
    context = { ...context, idempotencyKey: context.idempotencyKey.trim() }
    const existing = await this.findByKey(context.orderId, context.idempotencyKey, context.ownerId)
    if (existing) return existing.payment
    let domainError: OrderError | undefined
    try {
      return await this.db.transaction(async client => {
        const deadline = Date.now() + this.limits.operationMs
        try {
          await this.query(client, 'SET TRANSACTION ISOLATION LEVEL READ COMMITTED', [], deadline)
          await this.query(client, "SELECT set_config('statement_timeout', $1, true), set_config('lock_timeout', $2, true), set_config('idle_in_transaction_session_timeout', $3, true)",
            [this.limits.sqlMs + 'ms', this.limits.lockMs + 'ms', this.limits.operationMs + 'ms'], deadline)
          let order
          try { order = await this.orders.readForPayment(client, context.orderId, context.ownerId, this.remaining(deadline), true) }
          catch (error) { if (sqlStateOf(error) === '55P03') throw paymentInProgress(); throw error }
          if (!order) throw missingOrder()
          // Otra sentencia READ COMMITTED observa un intento confirmado antes de adquirir el lock.
          const replay = await this.query(client, 'SELECT * FROM commerce.payment_attempts WHERE order_id = $1 AND idempotency_key = $2', [context.orderId, context.idempotencyKey], deadline)
          if (replay.rows.length) {
            const attempt = mapPaymentRow(replay.rows[0])
            if (replay.rows.length !== 1 || attempt.orderId !== context.orderId || attempt.idempotencyKey !== context.idempotencyKey) throw new DatabaseError('transaction')
            return attempt.payment
          }
          if (order.orderStatus === 'CONFIRMED' || order.paymentStatus === 'APPROVED') {
            throw new OrderError(409, 'ORDER_ALREADY_CONFIRMED', 'La orden ya fue confirmada y no admite otro pago.')
          }
          const built = await this.build(build, order, deadline)
          this.remaining(deadline)
          // El builder no puede modificar los campos comerciales del snapshot original.
          const attempt = mapPaymentRow({ order_id: order.id, idempotency_key: context.idempotencyKey, scenario: context.scenario,
            result: built.result, processed_at: built.processedAt,
            order_snapshot: { ...order, orderStatus: built.order.orderStatus, paymentStatus: built.order.paymentStatus } })
          const updated = await this.orders.updateWithClient(client, attempt.payment.order, context.ownerId, this.remaining(deadline))
          if (!updated) throw missingOrder()
          const inserted = await this.query(client, `INSERT INTO commerce.payment_attempts
            (order_id, idempotency_key, scenario, result, processed_at, order_snapshot) VALUES ($1,$2,$3,$4,$5,$6::jsonb) RETURNING *`,
            [order.id, context.idempotencyKey, context.scenario, attempt.payment.result, attempt.payment.processedAt, JSON.stringify(updated)], deadline)
          this.remaining(deadline)
          if (inserted.rows.length !== 1) throw new DatabaseError('transaction')
          return mapPaymentRow(inserted.rows[0]).payment
        } catch (error) { if (error instanceof OrderError) domainError = error; throw error }
      }, { queryTimeoutMs: this.limits.sqlMs })
    } catch (error) {
      if (domainError) throw domainError
      if (error instanceof DatabaseError && error.outcome === 'unknown') {
        try {
          const recovered = await this.findByKey(context.orderId, context.idempotencyKey, context.ownerId)
          if (recovered) return recovered.payment
        } catch (recoveryError) { if (recoveryError instanceof OrderError && recoveryError.status === 404) throw recoveryError }
        // Una lectura vacía no prueba rollback; nunca reejecutar el builder ni cambiar la key.
        throw new PaymentPersistenceError('unknown')
      }
      throw paymentPersistenceError(error)
    }
  }

  /** Lease independiente READ ONLY, también para reconciliar COMMIT incierto. */
  private async readAttempts(orderId: string, ownerId: string, key?: string): Promise<PaymentAttempt[]> {
    let client: PoolClient | undefined, failure: unknown
    let discard = false
    let attempts: PaymentAttempt[] = []
    const onError = (error: unknown) => { failure ??= error; discard = true }
    try {
      client = await this.db.connect()
      client.on('error', onError)
      const deadline = Date.now() + this.limits.operationMs
      await this.query(client, 'BEGIN READ ONLY', [], deadline)
      const order = await this.orders.readForPayment(client, orderId, ownerId, this.remaining(deadline))
      if (!order) throw missingOrder()
      const rows = await this.query(client, 'SELECT * FROM commerce.payment_attempts WHERE order_id = $1'
        + (key === undefined ? ' ORDER BY processed_at, idempotency_key' : ' AND idempotency_key = $2'), key === undefined ? [orderId] : [orderId, key], deadline)
      attempts = rows.rows.map(mapPaymentRow)
      if (attempts.some(attempt => attempt.orderId !== orderId || (key !== undefined && attempt.idempotencyKey !== key))) throw new DatabaseError('transaction')
    } catch (error) { failure = error; discard = discard || !(error instanceof OrderError) }
    finally {
      if (client) {
        try { const statement = { text: 'ROLLBACK', query_timeout: this.limits.sqlMs }; await client.query(statement) }
        catch (error) { failure ??= error; discard = true }
        try { client.release(discard) } catch (error) { failure ??= error }
        finally { client.off('error', onError) }
      }
    }
    if (failure instanceof OrderError) throw failure
    if (failure !== undefined) throw paymentPersistenceError(failure)
    return attempts
  }
  async findByKey(orderId: string, key: string, ownerId: string): Promise<PaymentAttempt | undefined> {
    return (await this.readAttempts(orderId, ownerId, key.trim()))[0]
  }
  findByOrder(orderId: string, ownerId: string): Promise<PaymentAttempt[]> { return this.readAttempts(orderId, ownerId) }
}
