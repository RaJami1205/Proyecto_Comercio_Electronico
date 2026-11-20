/** F3: clasificación estricta y propagación por los consumidores reales usando dobles de pg, sin IO externo. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseError, databaseError } from '../dist/db/databaseError.js'
import { PaymentPersistenceError, paymentPersistenceError } from '../dist/domain/paymentPersistenceError.js'
import { PaymentService } from '../dist/services/paymentService.js'
import { paymentDatabase } from './helpers/paymentDatabase.mjs'
import { owner, paymentRequest } from './helpers/commerceFixtures.mjs'

function assertSanitized(error, reason) {
  assert.ok(error instanceof PaymentPersistenceError)
  assert.equal(error.reason, reason)
  assert.equal(error.status, 503)
  assert.equal(error.code, 'UNEXPECTED_ERROR')
  assert.equal(error.outcome, reason === 'unknown' ? 'unknown' : 'not-committed')
  assert.equal(error.cause, undefined)
  assert.doesNotMatch(error.message, /PRIVATE|Query read timeout|SQLSTATE/)
}

test('timeout nativo exacto de pg se clasifica sin exponer el error original', () => {
  const native = Object.assign(new Error('Query read timeout'), { detail: 'PRIVATE' })
  assertSanitized(paymentPersistenceError(native), 'timeout')
})

test('sanitización conserva la categoría de timeout antes de llegar a Payment', () => {
  const sanitized = databaseError(new Error('Query read timeout'), 'rolled-back')
  assert.equal(sanitized.kind, 'timeout')
  assert.equal(sanitized.outcome, 'rolled-back')
  assert.equal(sanitized.sqlState, undefined)
  assert.equal(sanitized.cause, undefined)
  assert.doesNotMatch(sanitized.message, /Query read timeout/)
  assertSanitized(paymentPersistenceError(sanitized), 'timeout')
})

for (const error of [
  Object.assign(new Error('PRIVATE SQLSTATE'), { code: '57014' }),
  new DatabaseError('transaction', 'rolled-back', '57014'),
]) test('conserva timeout SQLSTATE 57014: ' + error.constructor.name, () => {
  assertSanitized(paymentPersistenceError(error), 'timeout')
})

for (const [kind, sqlState] of [['uncertain-commit', undefined], ['transaction', '57014'], ['timeout', '57014']]) {
  test('outcome unknown tiene prioridad sobre timeout: ' + kind, () => {
    assertSanitized(paymentPersistenceError(new DatabaseError(kind, 'unknown', sqlState)), 'unknown')
  })
}

for (const reason of ['timeout', 'unknown']) test('conserva PaymentPersistenceError ya tipado: ' + reason, () => {
  const error = new PaymentPersistenceError(reason)
  assert.equal(paymentPersistenceError(error), error)
})

for (const [label, error] of [
  ['palabra arbitraria', new Error('Network timeout PRIVATE')],
  ['prefijo adicional', new Error('PRIVATE Query read timeout')],
  ['sufijo adicional', new Error('Query read timeout PRIVATE')],
  ['casing distinto', new Error('query read timeout')],
  ['salto final', new Error('Query read timeout\n')],
  ['tipo de error distinto', new SyntaxError('Query read timeout')],
  ['objeto sin Error', { message: 'Query read timeout' }],
  ['string', 'Query read timeout'],
  ['null', null],
  ['SQLSTATE incompatible', Object.assign(new Error('Query read timeout'), { code: '23514' })],
]) test('no confía en mensajes de timeout arbitrarios: ' + label, () => {
  assertSanitized(paymentPersistenceError(error), 'storage')
  assert.notEqual(databaseError(error).kind, 'timeout')
})

for (const stage of ['read', 'write']) test('Repository conserva timeout del Driver en ' + stage, async t => {
  const h = paymentDatabase(t)
  h.state.fail = { when: sql => stage === 'read' ? sql.startsWith('SELECT * FROM commerce.payment_attempts') : sql.startsWith('INSERT INTO commerce.payment_attempts'),
    error: new Error('Query read timeout') }
  const payments = new PaymentService(h.orderStore, { process: async input => ({ result: input.scenario }) }, h.payments)
  await assert.rejects(payments.process('order-a', paymentRequest(), owner.id), error => { assertSanitized(error, 'timeout'); return true })
  assert.equal(h.attempts.size, 0)
  assert.equal(h.orders.get('order-a').order_status, 'PENDING')
  assert.equal(h.locks.size, 0)
})

test('timeout del Driver durante COMMIT permanece unknown tras rollback y reconciliación vacía', async t => {
  const h = paymentDatabase(t); let executions = 0
  h.state.fail = { when: sql => sql === 'COMMIT', error: new Error('Query read timeout') }
  const payments = new PaymentService(h.orderStore, { process: async input => { executions++; return { result: input.scenario } } }, h.payments)
  await assert.rejects(payments.process('order-a', paymentRequest(), owner.id), error => { assertSanitized(error, 'unknown'); return true })
  const commit = h.calls.find(call => call.text === 'COMMIT')
  assert.equal(h.releases.find(item => item.id === commit.id).discard, true)
  assert.ok(h.calls.some(call => call.id > commit.id && call.text === 'BEGIN READ ONLY'))
  assert.equal(executions, 1)
  assert.equal(h.attempts.size, 0)
})
