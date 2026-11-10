/** Doble acotado de pg: comprueba protocolo/cleanup, no prueba los locks reales de PostgreSQL. */
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { Database } from '../../dist/db/pool.js'
import { PostgreSQLOrderStore } from '../../dist/stores/postgreSQLOrderStore.js'
import { PostgreSQLPaymentStore } from '../../dist/stores/postgreSQLPaymentStore.js'
import { orderToRow } from '../../dist/stores/orderRowMapper.js'
import { orderFixture, owner } from './commerceFixtures.mjs'

export const privateError = code => Object.assign(new Error('PRIVATE DSN password SQL certificate'), { code })
export function paymentDatabase(t, limits) {
  const orders = new Map(['order-a', 'order-b'].map(id => [id, orderToRow(orderFixture(id), owner)]))
  const attempts = new Map(), locks = new Map(), calls = [], releases = []
  const state = { fail: undefined, commit: undefined, recoveryError: undefined, beforeLock: undefined, corruptAttempt: undefined }
  let sequence = 0, recoveryAfter = Infinity
  const keyOf = (id, key) => JSON.stringify([id, key])
  const pool = new EventEmitter()
  pool.connect = async () => {
    const client = new EventEmitter(), id = ++sequence
    let changed, inserted, locked
    const finish = commit => {
      if (commit) {
        if (changed) orders.set(changed.id, structuredClone(changed))
        if (inserted) attempts.set(keyOf(inserted.order_id, inserted.idempotency_key), structuredClone(inserted))
      }
      if (locked) locks.delete(locked)
      changed = inserted = locked = undefined
    }
    client.query = async statement => {
      const text = typeof statement === 'string' ? statement : statement.text
      const values = statement.values ?? []
      calls.push({ id, text, values, timeout: statement.query_timeout })
      const result = rows => ({ rows: structuredClone(rows), rowCount: rows.length, command: text.split(' ')[0] })
      if (state.fail?.when(text)) { const error = state.fail.error; state.fail = undefined; throw error }
      if (id > recoveryAfter && state.recoveryError) { const error = state.recoveryError; state.recoveryError = undefined; throw error }
      if (text === 'BEGIN' || text === 'BEGIN READ ONLY' || text.startsWith('SET TRANSACTION') || text.startsWith('SELECT set_config')) return result([])
      if (text === 'ROLLBACK') { finish(false); return result([]) }
      if (text === 'COMMIT') {
        const mode = state.commit; state.commit = undefined
        finish(mode !== 'empty')
        if (mode) { recoveryAfter = id; throw privateError('ECONNRESET') }
        return result([])
      }
      if (text.startsWith('SELECT * FROM commerce.orders')) {
        if (text.includes('FOR UPDATE') && state.beforeLock) { const run = state.beforeLock; state.beforeLock = undefined; run() }
        const row = changed?.id === values[0] ? changed : orders.get(values[0])
        if (!row || row.owner_user_id !== values[1]) return result([])
        if (text.includes('FOR UPDATE')) {
          if (locks.has(row.id) && locks.get(row.id) !== id) throw privateError('55P03')
          locks.set(row.id, id); locked = row.id
        }
        return result([row])
      }
      if (text.startsWith('SELECT * FROM commerce.payment_attempts')) {
        const found = [...attempts.values()].filter(row => row.order_id === values[0] && (values.length === 1 || row.idempotency_key === values[1]))
        return result(state.corruptAttempt && found.length ? found.map(state.corruptAttempt) : found)
      }
      if (text.startsWith('UPDATE commerce.orders')) {
        const row = orders.get(values[3])
        if (!row || row.owner_user_id !== values[4]) return result([])
        assert.equal(locks.get(row.id), id)
        changed = { ...row, order_status: values[0], payment_status: values[1], updated_at: values[2] }
        return result([changed])
      }
      if (text.startsWith('INSERT INTO commerce.payment_attempts')) {
        const [order_id, idempotency_key, scenario, outcome, processed_at, snapshot] = values
        if (attempts.has(keyOf(order_id, idempotency_key))) throw privateError('23505')
        inserted = { order_id, idempotency_key, scenario, result: outcome, processed_at, order_snapshot: JSON.parse(snapshot) }
        return result([inserted])
      }
      assert.fail('SQL inesperado en doble: ' + text)
    }
    client.release = discard => { releases.push({ id, discard }); if (discard) finish(false) }
    return client
  }
  pool.end = async () => {}
  const db = new Database(() => ({}), () => pool)
  const orderStore = new PostgreSQLOrderStore(db)
  const payments = new PostgreSQLPaymentStore(orderStore, db, limits)
  t.after(() => db.close())
  return { db, orderStore, payments, orders, attempts, locks, calls, releases, state, keyOf }
}
