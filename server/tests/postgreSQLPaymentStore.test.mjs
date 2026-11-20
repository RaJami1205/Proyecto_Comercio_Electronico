/** CN-59 local: dobles de pg sin sockets, credenciales, migrations ni servicios externos. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { Database } from '../dist/db/pool.js'
import { DatabaseError } from '../dist/db/databaseError.js'
import { PaymentService } from '../dist/services/paymentService.js'
import { paymentService } from '../dist/services/paymentService.js'
import { orderService } from '../dist/services/orderService.js'
import { commerceStores } from '../dist/stores/commerceStores.js'
import { InMemoryOrderStore, orderStore } from '../dist/stores/orderStore.js'
import { InMemoryPaymentStore } from '../dist/stores/paymentStore.js'
import { PostgreSQLOrderStore } from '../dist/stores/postgreSQLOrderStore.js'
import { PostgreSQLPaymentStore } from '../dist/stores/postgreSQLPaymentStore.js'
import { mapPaymentRow } from '../dist/stores/paymentRowMapper.js'
import { createCommerceStores } from '../dist/stores/commerceStoreFactory.js'
import { PaymentPersistenceError } from '../dist/domain/paymentPersistenceError.js'
import { paymentDatabase, privateError } from './helpers/paymentDatabase.mjs'
import { owner, orderFixture, paymentRequest } from './helpers/commerceFixtures.mjs'

const service = (h, sandbox = { process: async input => ({ result: input.scenario }) }) => new PaymentService(h.orderStore, sandbox, h.payments)
const context = (key = 'attempt', scenario = 'PAYMENT_APPROVED') => ({ orderId: 'order-a', ownerId: owner.id, idempotencyKey: key, scenario })

for (const [scenario, paymentStatus, orderStatus] of [
  ['PAYMENT_APPROVED', 'APPROVED', 'CONFIRMED'], ['PAYMENT_DECLINED', 'DECLINED', 'PENDING'], ['PAYMENT_ERROR', 'ERROR', 'PENDING'],
]) test('pg Payment atómico: ' + scenario, async t => {
  const h = paymentDatabase(t), payments = service(h)
  const result = await payments.process('order-a', { ...paymentRequest(scenario, '  attempt  '), amount: 1, currency: 'USD', card: 'ignored' }, owner.id)
  assert.equal(result.result, scenario); assert.equal(result.order.paymentStatus, paymentStatus); assert.equal(result.order.orderStatus, orderStatus)
  assert.deepEqual(result.order.totals, orderFixture().totals); assert.deepEqual(result.order.termsAcceptance, orderFixture().termsAcceptance)
  const attempt = [...h.attempts.values()][0]
  assert.equal(attempt.idempotency_key, 'attempt'); assert.equal(attempt.scenario, scenario)
  assert.deepEqual(attempt.order_snapshot, result.order); assert.equal('card' in attempt, false)
  const writes = h.calls.filter(call => /^(UPDATE|INSERT|COMMIT)/.test(call.text))
  assert.equal(new Set(writes.map(call => call.id)).size, 1)
  const transaction = h.calls.filter(call => call.id === writes[0].id)
  assert.equal(transaction[0].text, 'BEGIN'); assert.equal(transaction.at(-1).text, 'COMMIT')
  assert.ok(transaction.some(call => call.text.endsWith('FOR UPDATE NOWAIT')))
  assert.ok(transaction.some(call => call.text === 'SET TRANSACTION ISOLATION LEVEL READ COMMITTED'))
  assert.equal(h.locks.size, 0)
})

for (const scenario of ['PAYMENT_DECLINED', 'PAYMENT_ERROR']) test('histórico y scenario originales sobreviven a Retry y recreación: ' + scenario, async t => {
  const h = paymentDatabase(t); let calls = 0
  const firstService = service(h, { process: async input => { calls++; return { result: input.scenario } } })
  const first = await firstService.process('order-a', paymentRequest(scenario), owner.id)
  await firstService.process('order-a', paymentRequest('PAYMENT_APPROVED', 'retry'), owner.id)
  const recreated = new PaymentService(h.orderStore, { process: async () => assert.fail('Replay no ejecuta Sandbox') }, new PostgreSQLPaymentStore(h.orderStore, h.db))
  assert.deepEqual(await recreated.process('order-a', paymentRequest('PAYMENT_APPROVED'), owner.id), first)
  assert.equal((await h.payments.findByKey('order-a', 'attempt', owner.id)).scenario, scenario)
  assert.equal((await h.payments.findByOrder('order-a', owner.id)).length, 2)
  assert.equal(h.orders.get('order-a').order_status, 'CONFIRMED'); assert.equal(calls, 2)
  await assert.rejects(recreated.process('order-a', paymentRequest('PAYMENT_APPROVED', 'new'), owner.id), { code: 'ORDER_ALREADY_CONFIRMED' })
})

test('Ownership precede a Replay, mapping de snapshot y locks', async t => {
  const h = paymentDatabase(t), payments = service(h)
  await payments.process('order-a', paymentRequest(), owner.id)
  h.state.corruptAttempt = row => ({ ...row, order_snapshot: null })
  const before = h.calls.length
  await assert.rejects(payments.process('order-a', paymentRequest(), 'other'), { status: 404 })
  await assert.rejects(h.payments.findByOrder('order-a', 'other'), { status: 404 })
  assert.equal(h.calls.slice(before).some(call => call.text.includes('FROM commerce.payment_attempts') || call.text.includes('FOR UPDATE')), false)
})

for (const key of ['attempt', 'different']) test('NOWAIT / 55P03 después de rollback: ' + key, async t => {
  const h = paymentDatabase(t); let started, release, builds = 0
  const began = new Promise(resolve => { started = resolve }), gate = new Promise(resolve => { release = resolve })
  const first = service(h, { process: async () => { builds++; started(); await gate; return { result: 'PAYMENT_DECLINED' } } })
  const running = first.process('order-a', paymentRequest('PAYMENT_DECLINED'), owner.id)
  await began
  const other = new PaymentService(h.orderStore, { process: async () => assert.fail() }, new PostgreSQLPaymentStore(h.orderStore, h.db))
  await assert.rejects(other.process('order-a', paymentRequest('PAYMENT_APPROVED', key), owner.id), { status: 409, code: 'PAYMENT_IN_PROGRESS' })
  const failedLock = h.calls.filter(call => call.text.includes('FOR UPDATE')).at(-1)
  assert.equal(h.calls.filter(call => call.id === failedLock.id).at(-1).text, 'ROLLBACK')
  release(); const result = await running
  assert.equal(builds, 1); assert.equal(h.attempts.size, 1); assert.equal(h.locks.size, 0)
  assert.deepEqual(await other.process('order-a', paymentRequest('PAYMENT_APPROVED'), owner.id), result)
})

test('keys y locks independientes por Order; Replay disponible durante otro intento', async t => {
  const h = paymentDatabase(t), payments = service(h)
  const declined = await payments.process('order-a', paymentRequest('PAYMENT_DECLINED'), owner.id)
  let started, release
  const began = new Promise(resolve => { started = resolve }), gate = new Promise(resolve => { release = resolve })
  const waiting = service(h, { process: async () => { started(); await gate; return { result: 'PAYMENT_APPROVED' } } })
  const pending = waiting.process('order-a', paymentRequest('PAYMENT_APPROVED', 'retry'), owner.id)
  await began
  assert.deepEqual(await payments.process('order-a', paymentRequest(), owner.id), declined)
  await payments.process('order-b', paymentRequest(), owner.id)
  release(); await pending
  assert.equal(h.attempts.size, 3)
})

test('relee Attempt tras lock antes de rechazar CONFIRMED', async t => {
  const h = paymentDatabase(t)
  const payment = { result: 'PAYMENT_APPROVED', processedAt: '2026-11-10T12:00:00.000Z', order: { ...orderFixture(), paymentStatus: 'APPROVED', orderStatus: 'CONFIRMED' } }
  h.state.beforeLock = () => {
    h.orders.get('order-a').payment_status = 'APPROVED'; h.orders.get('order-a').order_status = 'CONFIRMED'
    h.attempts.set(h.keyOf('order-a', 'attempt'), { order_id: 'order-a', idempotency_key: 'attempt', scenario: 'PAYMENT_APPROVED', result: payment.result, processed_at: payment.processedAt, order_snapshot: payment.order })
  }
  assert.deepEqual(await h.payments.processOrReplay(context(), async () => assert.fail()), payment)
})

for (const stage of ['UPDATE', 'INSERT', 'COMMIT']) test('rollback conjunto ante error en ' + stage, async t => {
  const h = paymentDatabase(t)
  h.state.fail = { when: sql => sql.startsWith(stage), error: privateError('23514') }
  await assert.rejects(service(h).process('order-a', paymentRequest(), owner.id), error => error.status === 503 && !/PRIVATE|password|SQL/.test(error.message) && !error.cause)
  assert.equal(h.orders.get('order-a').order_status, 'PENDING'); assert.equal(h.attempts.size, 0); assert.equal(h.locks.size, 0)
})

for (const [code, reason] of [['57014', 'timeout'], ['40P01', 'deadlock'], ['ECONNRESET', 'unavailable']]) test('infraestructura diferenciada: ' + code, async t => {
  const h = paymentDatabase(t)
  h.state.fail = { when: sql => sql.startsWith('INSERT'), error: privateError(code) }
  await assert.rejects(service(h).process('order-a', paymentRequest(), owner.id), error => error instanceof PaymentPersistenceError && error.reason === reason)
  assert.equal(h.orders.get('order-a').order_status, 'PENDING'); assert.equal(h.attempts.size, 0)
})

for (const mode of ['confirmed', 'empty', 'unavailable']) test('COMMIT incierto: ' + mode, async t => {
  const h = paymentDatabase(t); let calls = 0
  h.state.commit = mode === 'empty' ? 'empty' : 'confirmed'
  if (mode === 'unavailable') h.state.recoveryError = privateError('ECONNRESET')
  const attempt = service(h, { process: async input => { calls++; return { result: input.scenario } } }).process('order-a', paymentRequest(), owner.id)
  if (mode === 'confirmed') assert.equal((await attempt).result, 'PAYMENT_APPROVED')
  else await assert.rejects(attempt, { status: 503, outcome: 'unknown' })
  assert.equal(calls, 1)
  const commit = h.calls.find(call => call.text === 'COMMIT')
  const reconciliation = h.calls.find(call => call.id > commit.id && call.text === 'BEGIN READ ONLY')
  if (mode !== 'unavailable') assert.ok(reconciliation)
  assert.equal(h.releases.find(item => item.id === commit.id).discard, true)
  assert.equal(h.calls.filter(call => call.text.startsWith('INSERT')).length, 1)
})

test('timeout del Sandbox revierte y su resultado tardío no escribe', async t => {
  const h = paymentDatabase(t, { operationMs: 20 }); let finish
  const gate = new Promise(resolve => { finish = resolve })
  const payments = service(h, { process: async () => { await gate; return { result: 'PAYMENT_APPROVED' } } })
  await assert.rejects(payments.process('order-a', paymentRequest(), owner.id), { reason: 'timeout' })
  finish(); await new Promise(resolve => setImmediate(resolve))
  assert.equal(h.calls.some(call => /^(INSERT|UPDATE)/.test(call.text)), false)
  assert.equal(h.locks.size, 0); assert.equal(h.attempts.size, 0)
})

test('composición coordinada es lazy, In-Memory por defecto y rechaza mezclas/Database distinta', async t => {
  const h = paymentDatabase(t), memory = createCommerceStores(), other = new Database(() => assert.fail('No configurar durante composición'))
  assert.ok(memory.orders instanceof InMemoryOrderStore); assert.ok(memory.payments instanceof InMemoryPaymentStore)
  assert.ok(orderStore instanceof InMemoryOrderStore)
  assert.equal(orderService.store, commerceStores.orders)
  assert.equal(paymentService.store, commerceStores.orders)
  assert.equal(paymentService.persistence, commerceStores.payments)
  assert.throws(() => new PaymentService(h.orderStore), { kind: 'configuration' })
  assert.throws(() => new PaymentService(memory.orders, undefined, h.payments), { kind: 'configuration' })
  assert.throws(() => new PostgreSQLPaymentStore(h.orderStore, other), { kind: 'configuration' })
  const pair = createCommerceStores('postgresql', other)
  assert.ok(pair.payments.isFor(pair.orders)); assert.equal(pair.orders.usesDatabase(other), true)
  await other.close()
  const script = `import net from 'node:net'; import assert from 'node:assert/strict'; net.Socket.prototype.connect=()=>{throw new Error('Socket inesperado')};
    const {createCommerceStores}=await import(${JSON.stringify(new URL('../dist/stores/commerceStoreFactory.js', import.meta.url).href)});
    const {InMemoryOrderStore}=await import(${JSON.stringify(new URL('../dist/stores/orderStore.js', import.meta.url).href)});
    assert.ok(createCommerceStores().orders instanceof InMemoryOrderStore); createCommerceStores('postgresql');`
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8', env: { SystemRoot: process.env.SystemRoot, PATH: process.env.PATH, DATABASE_URL: 'postgres://fake:fake@db.example/postgres' } })
  assert.equal(result.status, 0, result.stderr)
})

const validRow = () => ({ order_id: 'order-a', idempotency_key: 'attempt', scenario: 'PAYMENT_ERROR', result: 'PAYMENT_DECLINED',
  processed_at: new Date('2026-11-10T12:00:00.123Z'), order_snapshot: { ...orderFixture(), paymentStatus: 'DECLINED' } })
test('mapper conserva scenario original distinto del resultado, precisión y UTC', () => {
  const mapped = mapPaymentRow(validRow())
  assert.equal(mapped.scenario, 'PAYMENT_ERROR'); assert.equal(mapped.payment.result, 'PAYMENT_DECLINED')
  assert.equal(mapped.payment.processedAt, '2026-11-10T12:00:00.123Z'); assert.equal(mapped.payment.order.totals.subtotal, 99999.995)
})
for (const [index, patch] of [
  { result: 'INVALID' }, { scenario: 'INVALID' }, { order_id: 'other' }, { idempotency_key: ' ' },
  { processed_at: '2026-02-31T12:00:00Z' }, { order_snapshot: null },
  { order_snapshot: { ...orderFixture(), paymentStatus: 'APPROVED', orderStatus: 'CONFIRMED' } },
  { order_snapshot: { ...validRow().order_snapshot, totals: { ...orderFixture().totals, total: '1' } } },
  { order_snapshot: { ...validRow().order_snapshot, termsAcceptance: { ...orderFixture().termsAcceptance, acceptedAt: '2026-02-29T12:00:00Z' } } },
  { order_snapshot: { ...validRow().order_snapshot, paymentStatus: ['DECLINED'] } },
].entries()) test('mapper de Payment rechaza unknown inválido: ' + index + ' / ' + Object.keys(patch).join(','), () => {
  assert.throws(() => mapPaymentRow({ ...validRow(), ...patch }), DatabaseError)
})
