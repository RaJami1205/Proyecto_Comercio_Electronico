/** CN-58: protocolo con dobles de pg. No verifica garantías reales de PostgreSQL ni abre sockets. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { spawnSync } from 'node:child_process'
import { Database } from '../dist/db/pool.js'
import { DatabaseError } from '../dist/db/databaseError.js'
import { OrderError } from '../dist/domain/orderError.js'
import { OrderPersistenceError } from '../dist/domain/orderPersistenceError.js'
import { orderIdentity } from '../dist/domain/orderIdentity.js'
import { calculateOrderTotals } from '../dist/domain/orderCalculations.js'
import { PostgreSQLOrderStore } from '../dist/stores/postgreSQLOrderStore.js'
import { createOrderStore } from '../dist/stores/orderStoreFactory.js'
import { InMemoryOrderStore } from '../dist/stores/orderStore.js'
import { OrderService } from '../dist/services/orderService.js'
import { ORDER_COLUMNS, mapOrderRow, orderToRow } from '../dist/stores/orderRowMapper.js'

const user = { id: 'buyer-a', displayName: 'Cliente A', role: 'B2C' }
const fixture = id => {
  const items = [{ productId: 'p', name: 'Producto', image: '', unitPrice: 49999.9975, quantity: 2, lineSubtotal: 99999.995 }]
  return { id, orderNumber: 'CN-2026-' + id.toUpperCase(), createdAt: '2026-10-12T12:00:00.000Z',
    buyer: { fullName: 'Cliente', email: 'test@example.com', phone: '88888888' },
    delivery: { province: 'San José', canton: 'Central', address: 'Ficticia' }, items, totals: calculateOrderTotals(items),
    currency: 'CRC', orderStatus: 'PENDING', paymentStatus: 'PENDING',
    termsAcceptance: { accepted: true, version: '2026-10-lab4-v1', acceptedAt: '2026-10-12T12:00:00.000Z' } }
}
const context = (key = 'global-key', identity = user) => ({ idempotencyKey: key, canonicalVersion: 1, canonicalPayload: orderIdentity(fixture('x')), user: identity })
const sqlError = code => Object.assign(new Error('PRIVATE DSN password certificate SQL'), { code })

/** Modelo deliberadamente acotado: simula claims/commit/rollback para probar el protocolo del repositorio. */
function harness(t) {
  const orders = new Map(), requests = new Map(), claims = new Map(), calls = [], releases = []
  let sequence = 0
  const state = { fail: undefined, commit: undefined, readError: undefined, rowTransform: row => row }
  function client() {
    const connection = new EventEmitter(), id = ++sequence
    let claim, inserted, changed
    const finish = commit => {
      if (commit) {
        if (claim) { requests.set(claim.key, claim); orders.set(claim.orderId, inserted) }
        if (changed) orders.set(changed.id, changed)
      }
      if (claim) { claims.delete(claim.key); claim.release() }
      claim = inserted = changed = undefined
    }
    connection.query = async statement => {
      const text = typeof statement === 'string' ? statement : statement.text
      const values = typeof statement === 'string' ? [] : statement.values ?? []
      calls.push({ id, text, values, timeout: statement.query_timeout })
      const result = rows => ({ rows, rowCount: rows.length, command: text.split(' ')[0] })
      if (state.fail?.when(text)) { const error = state.fail.error; state.fail = undefined; throw error }
      if (text === 'BEGIN' || text === 'BEGIN READ ONLY' || text.startsWith('SET TRANSACTION') || text.startsWith('SELECT set_config')) return result([])
      if (text.startsWith('INSERT INTO commerce.order_creation_requests')) {
        const [key, owner, payload, version, orderId] = values
        while (claims.has(key)) await claims.get(key).done
        if (requests.has(key)) return result([])
        let release
        const done = new Promise(resolve => { release = resolve })
        claim = { key, owner, payload, version, orderId, done, release }
        claims.set(key, claim)
        return result([{ order_id: orderId }])
      }
      if (text.startsWith('INSERT INTO commerce.orders')) {
        inserted = Object.fromEntries(ORDER_COLUMNS.map((column, index) => [column,
          ['user_snapshot', 'buyer_snapshot', 'delivery_snapshot', 'items_snapshot'].includes(column) ? JSON.parse(values[index]) : values[index]]))
        return result([structuredClone(inserted)])
      }
      if (text === 'COMMIT') {
        const mode = state.commit; state.commit = undefined
        if (claim && !inserted) throw sqlError('23503')
        finish(mode !== 'empty')
        if (mode) throw sqlError('ECONNRESET')
        return result([])
      }
      if (text === 'ROLLBACK') { finish(false); return result([]) }
      if (text.includes('FROM commerce.order_creation_requests')) {
        if (state.readError) { const error = state.readError; state.readError = undefined; throw error }
        const request = requests.get(values[0])
        if (!request) return result([])
        const row = { ...structuredClone(orders.get(request.orderId)), request_owner_id: request.owner,
          canonical_payload: request.payload, canonical_version: request.version }
        return result([state.rowTransform(row)])
      }
      if (text.startsWith('SELECT * FROM commerce.orders')) {
        const row = orders.get(values[0])
        return result(row && (values.length === 1 || row.owner_user_id === values[1]) ? [structuredClone(row)] : [])
      }
      if (text.startsWith('UPDATE commerce.orders')) {
        const row = orders.get(values[3])
        if (!row || row.owner_user_id !== values[4]) return result([])
        changed = { ...structuredClone(row), order_status: values[0], payment_status: values[1], updated_at: values[2] }
        return result([structuredClone(changed)])
      }
      assert.fail('SQL no reconocido por el doble: ' + text)
    }
    connection.release = discard => { releases.push({ id, discard }); if (discard) finish(false) }
    return connection
  }
  const pool = new EventEmitter()
  pool.connect = async () => client()
  pool.end = async () => {}
  const db = new Database(() => ({}), () => pool)
  t.after(() => db.close())
  return { db, store: new PostgreSQLOrderStore(db), orders, requests, claims, calls, releases, state }
}

test('creación usa un client, claim antes del builder y commit conjunto; persiste snapshot exacto', async t => {
  const h = harness(t), input = context()
  const order = await h.store.createOrReplay(input, async id => {
    assert.equal(h.claims.has(input.idempotencyKey), true)
    assert.equal(h.orders.size, 0)
    return fixture(id)
  })
  assert.equal(h.orders.size, 1); assert.equal(h.requests.size, 1)
  assert.deepEqual(order, fixture(order.id))
  assert.equal(new Set(h.calls.map(call => call.id)).size, 1)
  assert.equal(h.calls[0].text, 'BEGIN')
  assert.ok(h.calls.some(call => call.text === 'SET TRANSACTION ISOLATION LEVEL READ COMMITTED'))
  assert.match(h.calls.find(call => call.text.startsWith('INSERT INTO commerce.order_creation_requests')).text, /ON CONFLICT \(idempotency_key\) DO NOTHING RETURNING/)
  assert.equal(h.calls.at(-1).text, 'COMMIT')
  assert.equal(h.orders.get(order.id).subtotal, '99999.995')
  assert.equal(h.orders.get(order.id).user_snapshot.id, user.id)
  assert.equal('ownerId' in order, false); assert.equal('user_snapshot' in order, false)
  assert.deepEqual(h.releases.map(value => value.discard), [false])
})

test('replay desde otra instancia devuelve estado actual sin invocar builder ni sustituir identidad histórica', async t => {
  const h = harness(t), input = context(), first = await h.store.createOrReplay(input, async id => fixture(id))
  await h.store.update({ ...first, orderStatus: 'CONFIRMED', paymentStatus: 'APPROVED', buyer: { ...first.buyer, fullName: 'No sobrescribir' } }, user.id)
  const next = new PostgreSQLOrderStore(h.db)
  const replay = await next.createOrReplay({ ...input, user: { ...user, displayName: 'Nombre nuevo' } }, async () => assert.fail('No reconstruir'))
  assert.equal(replay.id, first.id); assert.equal(replay.orderStatus, 'CONFIRMED')
  assert.equal(replay.buyer.fullName, first.buyer.fullName)
  assert.equal(h.orders.get(first.id).user_snapshot.displayName, user.displayName)
  assert.equal(h.orders.size, 1)
  assert.deepEqual(await next.findById(first.id), replay)
  assert.equal(await next.findByIdForOwner(first.id, 'other'), undefined)
})

test('owner precede a canonicalización y mapping; no filtra snapshots ajenos corruptos', async t => {
  const h = harness(t), input = context()
  await h.store.createOrReplay(input, async id => fixture(id))
  h.state.rowTransform = row => ({ ...row, buyer_snapshot: null, canonical_payload: 'PRIVATE' })
  await assert.rejects(h.store.createOrReplay(context(input.idempotencyKey, { ...user, id: 'other' }), async () => assert.fail()), { status: 404, code: 'ORDER_NOT_FOUND' })
  await assert.rejects(h.store.findByIdempotencyKey(input.idempotencyKey, 'other'), { status: 404 })
  assert.equal(h.orders.size, 1)
})

test('payload incompatible conserva 409 y fieldErrors a través del helper sanitizador', async t => {
  const h = harness(t), input = context()
  await h.store.createOrReplay(input, async id => fixture(id))
  await assert.rejects(h.store.createOrReplay({ ...input, canonicalPayload: 'different' }, async () => assert.fail()), error => error.status === 409 && !!error.fieldErrors.idempotencyKey)
  assert.equal(h.calls.at(-1).text, 'ROLLBACK')
})

test('concurrencia simulada entre repositorios: un claim ganador y una sola construcción', async t => {
  const h = harness(t), input = context(); let builds = 0
  const results = await Promise.all(Array.from({ length: 8 }, () => new PostgreSQLOrderStore(h.db).createOrReplay(input, async id => {
    builds++; await new Promise(resolve => setTimeout(resolve, 5)); return fixture(id)
  })))
  assert.equal(builds, 1); assert.equal(new Set(results.map(order => order.id)).size, 1)
  assert.equal(h.orders.size, 1); assert.equal(h.requests.size, 1); assert.equal(h.claims.size, 0)
})

test('fallo comercial hace rollback de claim y conserva OrderError; reintento explícito reutiliza key', async t => {
  const h = harness(t), input = context(), original = new OrderError(400, 'CHECKOUT_VALIDATION_ERROR', 'Datos no válidos', { items: 'Sin stock' })
  await assert.rejects(h.store.createOrReplay(input, async () => { throw original }), error => error === original)
  assert.equal(h.orders.size, 0); assert.equal(h.requests.size, 0); assert.equal(h.claims.size, 0)
  assert.equal(h.calls.at(-1).text, 'ROLLBACK')
  await h.store.createOrReplay(input, async id => fixture(id))
  assert.equal(h.orders.size, 1)
})

for (const stage of ['claim', 'order', 'commit']) {
  test('fallo SQL/UNIQUE en ' + stage + ' revierte ambas escrituras y se sanitiza', async t => {
    const h = harness(t)
    h.state.fail = { when: sql => stage === 'claim' ? sql.startsWith('INSERT INTO commerce.order_creation_requests') : stage === 'order' ? sql.startsWith('INSERT INTO commerce.orders') : sql === 'COMMIT', error: sqlError(stage === 'commit' ? '23503' : '23505') }
    await assert.rejects(h.store.createOrReplay(context(), async id => fixture(id)), error => error.status === 503 && !/PRIVATE|password|DSN/.test(error.message) && error.cause === undefined)
    assert.equal(h.orders.size, 0); assert.equal(h.requests.size, 0); assert.equal(h.claims.size, 0)
    assert.equal(h.calls.at(-1).text, 'ROLLBACK')
  })
}

for (const outcome of ['confirmed', 'empty', 'unavailable']) {
  test('COMMIT incierto y reconciliación: ' + outcome, async t => {
    const h = harness(t); let builds = 0
    h.state.commit = outcome === 'empty' ? 'empty' : 'confirmed'
    if (outcome === 'unavailable') h.state.readError = sqlError('ECONNRESET')
    const attempt = h.store.createOrReplay(context(), async id => { builds++; return fixture(id) })
    if (outcome === 'confirmed') assert.equal((await attempt).id, [...h.orders.keys()][0])
    else await assert.rejects(attempt, error => error instanceof OrderPersistenceError && error.status === 503 && error.outcome === 'unknown')
    assert.equal(builds, 1)
    const recovery = h.calls.find(call => call.text === 'BEGIN READ ONLY')
    assert.ok(recovery)
    assert.notEqual(recovery.id, h.calls[0].id)
    assert.equal(h.calls.at(-1).text, 'ROLLBACK')
    assert.equal(h.calls.filter(call => call.text.startsWith('INSERT INTO commerce.orders')).length, 1)
    assert.equal(h.releases[0].discard, true)
  })
}

test('timeout del catálogo revierte claim y su resolución tardía nunca inserta', async t => {
  const h = harness(t), store = new PostgreSQLOrderStore(h.db, { operationMs: 20 }); let finish, signal
  const gate = new Promise(resolve => { finish = resolve })
  await assert.rejects(store.createOrReplay(context(), async (id, abort) => { signal = abort; await gate; return fixture(id) }), { status: 503 })
  assert.equal(signal.aborted, true)
  finish(); await new Promise(resolve => setImmediate(resolve))
  assert.equal(h.calls.some(call => call.text.startsWith('INSERT INTO commerce.orders')), false)
  assert.equal(h.orders.size, 0); assert.equal(h.requests.size, 0); assert.equal(h.claims.size, 0)
})

test('configuración predeterminada permanece In-Memory incluso con DATABASE_URL; import no abre sockets', () => {
  const script = `import assert from 'node:assert/strict'; import net from 'node:net';
    net.Socket.prototype.connect=()=>{throw new Error('Socket inesperado')};
    const {orderStore,InMemoryOrderStore}=await import(${JSON.stringify(new URL('../dist/stores/orderStore.js', import.meta.url).href)});
    const {createOrderStore}=await import(${JSON.stringify(new URL('../dist/stores/orderStoreFactory.js', import.meta.url).href)});
    assert.ok(orderStore instanceof InMemoryOrderStore);assert.ok(createOrderStore() instanceof InMemoryOrderStore);
    createOrderStore('postgresql');`
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8',
    env: { SystemRoot: process.env.SystemRoot, PATH: process.env.PATH, DATABASE_URL: 'postgres://fake:fake@db.example/postgres' } })
  assert.equal(result.status, 0, result.stderr)
  assert.ok(createOrderStore() instanceof InMemoryOrderStore)
  assert.throws(() => createOrderStore('invalid'), { kind: 'configuration' })
})

test('mapper conserva precisión, Terms históricas y timestamps sin consultar política vigente', () => {
  const order = fixture('legacy'), row = orderToRow(order, user)
  row.terms_version = 'historical-version'
  row.created_at = new Date(order.createdAt); row.updated_at = new Date(order.createdAt); row.terms_accepted_at = new Date(order.createdAt)
  const mapped = mapOrderRow(row)
  assert.equal(mapped.totals.subtotal, 99999.995)
  assert.equal(mapped.items[0].unitPrice, 49999.9975)
  assert.equal(mapped.termsAcceptance.version, 'historical-version')
  assert.equal(mapped.createdAt, order.createdAt)
  for (const subtotal of [0, 0.1 + 0.2, 99999.49, 99999.50, 99999.995]) {
    assert.equal(mapOrderRow({ ...row, subtotal: String(subtotal) }).totals.subtotal, subtotal)
  }
})

for (const [column, readTimestamp] of [
  ['created_at', order => order.createdAt],
  ['terms_accepted_at', order => order.termsAcceptance.acceptedAt],
]) {
  test('mapper rechaza fechas calendáricas imposibles en ' + column, () => {
    const row = orderToRow(fixture('calendar'), user)
    for (const value of [
      '2026-02-29T12:00:00.000Z', '2026-02-30T12:00:00.000Z', '2026-02-31T12:00:00.000Z',
      '2024-02-30T12:00:00.000Z', '1900-02-29T12:00:00.000Z', '2100-02-29T12:00:00.000Z',
      '2026-04-31T12:00:00.000Z', '2026-00-15T12:00:00.000Z', '2026-13-15T12:00:00.000Z',
      '2026-01-00T12:00:00.000Z', '2026-01-32T12:00:00.000Z', '2026-02-31T23:30:00-01:00',
      new Date(NaN),
    ]) {
      assert.throws(() => mapOrderRow({ ...row, [column]: value }), DatabaseError, String(value))
    }
  })

  test('mapper conserva fechas válidas y normalización ISO UTC en ' + column, () => {
    const row = orderToRow(fixture('calendar'), user)
    for (const [value, expected] of [
      ['2026-02-28T12:00:00Z', '2026-02-28T12:00:00.000Z'],
      ['2024-02-29T12:00:00.1Z', '2024-02-29T12:00:00.100Z'],
      ['2000-02-29T12:00:00.12Z', '2000-02-29T12:00:00.120Z'],
      ['0096-02-29T12:00:00.123Z', '0096-02-29T12:00:00.123Z'],
      ['0000-02-29T12:00:00.000Z', '0000-02-29T12:00:00.000Z'],
      ['2026-02-28T23:30:00-01:00', '2026-03-01T00:30:00.000Z'],
      ['2026-03-01T00:30:00+01:00', '2026-02-28T23:30:00.000Z'],
      ['2024-02-29T23:30:00-01:00', '2024-03-01T00:30:00.000Z'],
      ['2026-04-30T12:00:00.000Z', '2026-04-30T12:00:00.000Z'],
      [new Date('2024-02-29T12:00:00.123Z'), '2024-02-29T12:00:00.123Z'],
    ]) {
      assert.equal(readTimestamp(mapOrderRow({ ...row, [column]: value })), expected, String(value))
    }
  })
}

test('mapper aplica validación calendárica también a updated_at', () => {
  assert.throws(() => mapOrderRow({ ...orderToRow(fixture('calendar'), user), updated_at: '2026-02-31T12:00:00.000Z' }), DatabaseError)
})

test('OrderService persiste usuario resuelto y descarta actor/precios forjados del body', async t => {
  const h = harness(t); let lookups = 0
  const service = new OrderService(h.store, async id => { lookups++; return { objectID: id, title: 'Producto', price: 49999.9975, in_stock: true, stock_quantity: 10 } })
  const input = { ...fixture('forged'), idempotencyKey: 'service', userId: 'attacker', role: 'ADMIN', user_snapshot: { id: 'attacker' } }
  input.items[0].unitPrice = 1
  const order = await service.create(input, user)
  assert.deepEqual(h.orders.get(order.id).user_snapshot, user)
  assert.equal(order.items[0].unitPrice, 49999.9975)
  assert.equal((await service.create(input, user)).id, order.id)
  assert.equal(lookups, 1)
  await assert.rejects(service.create(input, { ...user, role: 'ADMIN' }), { status: 403 })
  assert.ok(h.calls.every(call => call.timeout > 0 && call.timeout <= 2000))
})

for (const patch of [{ subtotal: 'NaN' }, { total: 'Infinity' }, { tax: '-1' }, { shipping: '' }, { created_at: 'invalid' },
  { terms_accepted: false }, { contract_version: 2 }, { items_snapshot: [] }, { buyer_snapshot: null },
  { payment_status: 'APPROVED' }, { user_snapshot: { ...user, role: 'ADMIN' } }, { owner_user_id: 'other' },
  { items_snapshot: [{ ...fixture('x').items[0], quantity: 1.5 }] }]) {
  test('mapper rechaza fila inválida: ' + Object.keys(patch).join(','), () => {
    assert.throws(() => mapOrderRow({ ...orderToRow(fixture('x'), user), ...patch }), DatabaseError)
  })
}
