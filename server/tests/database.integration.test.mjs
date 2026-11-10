/** PostgreSQL real solo con opt-in y URL de loopback. Requiere la migration aplicada manualmente en una base aislada. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { Database } from '../dist/db/pool.js'
import { DatabaseError } from '../dist/db/databaseError.js'
import { getDatabaseTestConfig } from '../dist/config/database.js'
import { calculateOrderTotals } from '../dist/domain/orderCalculations.js'

/** Revierte los fixtures incluso cuando las assertions pasan y conserva el fallo original si una assertion falla. */
async function rolledBack(db, operation) {
  const rollback = new DatabaseError('transaction')
  let original
  try {
    await db.transaction(async client => {
      try { await operation(client) } catch (error) { original = error; throw error }
      throw rollback
    })
  } catch (error) {
    if (error !== rollback) throw original ?? error
  }
}

/** Aísla una violación esperada para continuar consultando dentro de la misma transacción. */
async function rejectedStatement(client, sql, parameters, code) {
  await client.query('SAVEPOINT expected_rejection')
  await assert.rejects(client.query(sql, parameters), error => error.code === code)
  await client.query('ROLLBACK TO SAVEPOINT expected_rejection')
  await client.query('RELEASE SAVEPOINT expected_rejection')
}

const enabled = process.env.RUN_DATABASE_INTEGRATION_TESTS === '1'
test('CN-57 PostgreSQL real aislado', { skip: enabled ? false : 'Requiere RUN_DATABASE_INTEGRATION_TESTS=1 y DATABASE_TEST_URL local.', timeout: 15000 }, async t => {
  const db = new Database(() => ({ ...getDatabaseTestConfig(), max: 2 }))
  t.after(() => db.close())
  const tables = await db.query('SELECT table_name FROM information_schema.tables WHERE table_schema = $1 ORDER BY table_name', ['commerce'])
  assert.deepEqual(tables.rows.map(row => row.table_name), ['order_creation_requests', 'orders', 'payment_attempts'], 'Aplicar primero la migration en una base local aislada.')
  const columns = await db.query('SELECT numeric_scale FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2 AND column_name = $3', ['commerce', 'orders', 'subtotal'])
  assert.equal(columns.rows[0].numeric_scale, null)

  await t.test('COMMIT/ROLLBACK reales y conexiones concurrentes', async () => {
    // Cada callback crea su propia tabla TEMP. PostgreSQL las elimina al cerrar sus sesiones.
    const results = await Promise.all([1, 2].map(value => db.transaction(async client => {
      await client.query('CREATE TEMP TABLE IF NOT EXISTS cn57_transaction_probe (value INTEGER)')
      await client.query('INSERT INTO cn57_transaction_probe (value) VALUES ($1)', [value])
      const result = await client.query('SELECT value FROM cn57_transaction_probe WHERE value = $1', [value])
      assert.equal(result.rows[0].value, value)
      return value
    })))
    assert.deepEqual(results, [1, 2])
    await rolledBack(db, async client => {
      await client.query('CREATE TEMP TABLE cn57_rollback_probe (value INTEGER)')
      await client.query('INSERT INTO cn57_rollback_probe VALUES ($1)', [3])
    })
    const missing = await db.query('SELECT to_regclass($1) AS relation', ['pg_temp.cn57_rollback_probe'])
    assert.equal(missing.rows[0].relation, null)
  })

  await t.test('snapshots, precisión histórica, FKs, keys y permisos runtime', async () => {
    await rolledBack(db, async client => {
      const id = randomUUID(), owner = 'test-owner', now = new Date().toISOString()
      const items = [{ productId: 'p', name: 'Producto ficticio', image: '', quantity: 2, unitPrice: 49999.9975, lineSubtotal: 99999.995 }]
      const totals = calculateOrderTotals(items)
      const buyer = { fullName: 'Prueba', email: 'test@example.com', phone: '88888888' }
      const delivery = { province: 'San José', canton: 'Central', address: 'Ficticia' }
      const snapshot = { id, orderNumber: 'TEST-' + id, createdAt: now, buyer, delivery, items, totals, currency: 'CRC',
        orderStatus: 'PENDING', paymentStatus: 'DECLINED', termsAcceptance: { accepted: true, version: '2026-10-lab4-v1', acceptedAt: now } }
      const insert = `INSERT INTO commerce.orders
        (id, order_number, owner_user_id, user_snapshot, buyer_snapshot, delivery_snapshot, items_snapshot, currency,
         subtotal, tax, shipping, total, terms_accepted, terms_version, terms_accepted_at, order_status, payment_status, created_at, updated_at)
        VALUES ($1,$2,$3,$4::jsonb,$5::jsonb,$6::jsonb,$7::jsonb,'CRC',$8::numeric,$9::numeric,$10::numeric,$11::numeric,true,$12,$13,'PENDING','PENDING',$13,$13)`
      const parameters = [id, snapshot.orderNumber, owner, JSON.stringify({ id: owner, displayName: 'Prueba', role: 'B2C' }),
        JSON.stringify(buyer), JSON.stringify(delivery), JSON.stringify(items), String(totals.subtotal), String(totals.tax),
        String(totals.shipping), String(totals.total), snapshot.termsAcceptance.version, now]
      // La FK diferible admite reclamar key/owner antes de insertar la Order, dentro del mismo COMMIT.
      await client.query('INSERT INTO commerce.order_creation_requests VALUES ($1,$2,$3,1,$4,$5)', [id, owner, '["canonical"]', id, now])
      await client.query(insert, parameters)
      await client.query('SET CONSTRAINTS commerce.creation_order_owner_fk IMMEDIATE')
      const stored = (await client.query('SELECT subtotal, total, items_snapshot, branch_id FROM commerce.orders WHERE id = $1', [id])).rows[0]
      assert.equal(typeof stored.subtotal, 'string')
      assert.equal(Number(stored.subtotal), totals.subtotal)
      assert.equal(Number(stored.total), totals.total)
      assert.equal(stored.items_snapshot[0].unitPrice, 49999.9975)
      assert.equal(stored.branch_id, null)
      for (const value of [99999.49, 99999.50, 99999.995]) {
        assert.equal(Number((await client.query('SELECT $1::numeric AS value', [String(value)])).rows[0].value), value)
      }
      await rejectedStatement(client, 'INSERT INTO commerce.order_creation_requests VALUES ($1,$2,$3,1,$4,$5)', [id, 'other', '["canonical"]', randomUUID(), now], '23505')
      await rejectedStatement(client, 'UPDATE commerce.order_creation_requests SET owner_user_id = $1 WHERE idempotency_key = $2', ['other', id], '23503')
      for (const amount of ['-1', 'NaN', 'Infinity']) {
        await rejectedStatement(client, 'UPDATE commerce.orders SET subtotal = $1::numeric WHERE id = $2', [amount, id], '23514')
      }
      await rejectedStatement(client, 'UPDATE commerce.orders SET order_status = $1 WHERE id = $2', ['CONFIRMED', id], '23514')
      await rejectedStatement(client, 'UPDATE commerce.orders SET user_snapshot = $1::jsonb WHERE id = $2', [JSON.stringify({ id: owner, displayName: 'Admin', role: 'ADMIN' }), id], '23514')
      const attemptKey = randomUUID()
      await client.query('INSERT INTO commerce.payment_attempts VALUES ($1,$2,$3,$3,$4,$5::jsonb)', [id, attemptKey, 'PAYMENT_DECLINED', now, JSON.stringify(snapshot)])
      await rejectedStatement(client, 'INSERT INTO commerce.payment_attempts VALUES ($1,$2,$3,$3,$4,$5::jsonb)', [id, attemptKey, 'PAYMENT_DECLINED', now, JSON.stringify(snapshot)], '23505')
      await rejectedStatement(client, 'INSERT INTO commerce.payment_attempts VALUES ($1,$2,$3,$3,$4,$5::jsonb)', [id, randomUUID(), 'PAYMENT_APPROVED', now, JSON.stringify(snapshot)], '23514')
      await client.query("UPDATE commerce.orders SET order_status = 'CONFIRMED', payment_status = 'APPROVED' WHERE id = $1", [id])
      const history = await client.query('SELECT order_snapshot FROM commerce.payment_attempts WHERE order_id = $1 AND idempotency_key = $2', [id, attemptKey])
      assert.deepEqual(history.rows[0].order_snapshot, snapshot)
      await client.query('SET LOCAL ROLE commerce_runtime')
      assert.equal((await client.query('SELECT id FROM commerce.orders WHERE id = $1', [id])).rowCount, 1)
      await rejectedStatement(client, 'UPDATE commerce.orders SET owner_user_id = $1 WHERE id = $2', ['other', id], '42501')
      await rejectedStatement(client, 'UPDATE commerce.payment_attempts SET result = $1 WHERE order_id = $2', ['PAYMENT_APPROVED', id], '42501')
      await client.query('RESET ROLE')
      const exposed = await client.query("SELECT rolname FROM pg_roles WHERE rolname IN ('anon','authenticated','service_role') AND has_schema_privilege(oid, 'commerce', 'USAGE')")
      assert.deepEqual(exposed.rows, [])
    })
  })
})
