/** F2.3: DTOs reales y dobles de pg; sin conexiones reales ni recálculo de snapshots. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseError } from '../dist/db/databaseError.js'
import { mapOrderSnapshot, mapOrderRow, orderToRow } from '../dist/stores/orderRowMapper.js'
import { PaymentService } from '../dist/services/paymentService.js'
import { PostgreSQLPaymentStore } from '../dist/stores/postgreSQLPaymentStore.js'
import { PaymentPersistenceError } from '../dist/domain/paymentPersistenceError.js'
import { paymentDatabase } from './helpers/paymentDatabase.mjs'
import { orderFixture, owner, paymentRequest } from './helpers/commerceFixtures.mjs'

const company = { id: 'company-1', name: 'Empresa histórica' }
function snapshot(role) {
  const order = orderFixture()
  if (!role) return order
  return { ...order, contractVersion: 2,
    items: order.items.map(item => ({ ...item, minOrderQuantity: role === 'B2B' ? 2 : 1 })),
    commercial: { userId: owner.id, customerRole: role, ...(role === 'B2B' ? { company: { ...company } } : {}),
      branchId: 'san_jose', pricingType: role === 'B2B' ? 'WHOLESALE' : 'RETAIL', policyVersion: 'CIBERNOVA-COMMERCIAL-V1' } }
}
const userFor = role => role === 'B2B' ? { ...owner, role, company: { ...company } } : owner

for (const role of [undefined, 'B2C', 'B2B']) {
  test('snapshot legítimo conserva DTO y round-trip PostgreSQL: ' + (role ?? 'V1'), () => {
    const input = snapshot(role), before = structuredClone(input)
    assert.deepEqual(mapOrderSnapshot(input), before)
    assert.deepEqual(mapOrderRow(orderToRow(input, userFor(role))), before)
    assert.deepEqual(input, before)
  })
}

for (const version of [undefined, 1]) {
  test('V1 admite contexto comercial ausente o null, versión ' + String(version), () => {
    for (const commercial of [undefined, null]) {
      const input = { ...snapshot(), ...(version === undefined ? {} : { contractVersion: version }), commercial }
      assert.deepEqual(mapOrderSnapshot(input), snapshot())
    }
    const row = orderToRow(snapshot(), owner)
    assert.equal(row.branch_id, null)
    assert.equal(row.pricing_type, null)
    assert.equal(row.commercial_policy_version, null)
    assert.deepEqual(mapOrderRow(row), snapshot())
  })
}

test('V2 conserva campos opcionales de items y Terms históricas sin aplicar políticas actuales', () => {
  const input = snapshot('B2B')
  delete input.items[0].minOrderQuantity // El DTO histórico mantiene este campo opcional.
  input.termsAcceptance.version = 'historical-terms-version'
  input.commercial.policyVersion = ' historical-policy '
  input.commercial.company = { id: ' company-id ', name: ' Empresa histórica ' }
  const mapped = mapOrderSnapshot(input)
  assert.deepEqual(mapped, input)
  assert.equal(mapped.totals.subtotal, 99999.995)
  assert.equal(mapped.items[0].unitPrice, 49999.9975)
  assert.deepEqual(mapped.termsAcceptance, input.termsAcceptance)
})

for (const value of [undefined, null, {}, [], 'company',
  { id: 'co' }, { name: 'Empresa' }, { id: '', name: 'Empresa' }, { id: 'co', name: ' ' },
  { id: 1, name: 'Empresa' }, { id: 'co', name: false }, { id: { toString: () => 'co' }, name: 'Empresa' }]) {
  test('B2B rechaza Company incompleta o incompatible: ' + String(value === undefined ? 'ausente' : JSON.stringify(value)), () => {
    const input = snapshot('B2B')
    input.commercial.company = value
    assert.throws(() => mapOrderSnapshot(input), DatabaseError)
  })
}

test('proyecta Company y el contexto comercial sin campos extra ni referencias mutables al JSONB', () => {
  const input = snapshot('B2B'), expected = structuredClone(input)
  input.internal = 'PRIVATE_INTERNAL'
  input.commercial.internal = 'PRIVATE_COMMERCIAL'
  input.commercial.company.internal = 'PRIVATE_COMPANY'
  const mapped = mapOrderSnapshot(input)
  assert.deepEqual(mapped, expected)
  assert.notEqual(mapped.commercial.company, input.commercial.company)
  mapped.commercial.company.name = 'Cambio en el DTO'
  assert.equal(input.commercial.company.name, company.name)
})

for (const [field, literal] of [['customerRole', 'B2B'], ['pricingType', 'WHOLESALE']]) {
  for (const value of [1, true, false, null, {}, [literal], new String(literal)]) {
    test('rechaza enum comercial no literal: ' + field + ' / ' + JSON.stringify(value), () => {
      const input = snapshot('B2B')
      input.commercial[field] = value
      assert.throws(() => mapOrderSnapshot(input), DatabaseError)
    })
  }
  test('no ejecuta toString para validar ' + field, () => {
    let coercions = 0
    const input = snapshot('B2B')
    input.commercial[field] = { toString() { coercions++; return literal } }
    assert.throws(() => mapOrderSnapshot(input), DatabaseError)
    assert.equal(coercions, 0)
  })
}

for (const [customerRole, pricingType] of [['ADMIN', 'RETAIL'], ['B2C', 'WHOLESALE'], ['B2B', 'RETAIL'], [['B2B'], ['WHOLESALE']]]) {
  test('rechaza rol/pricing incompatibles: ' + JSON.stringify([customerRole, pricingType]), () => {
    const input = snapshot('B2B')
    Object.assign(input.commercial, { customerRole, pricingType })
    assert.throws(() => mapOrderSnapshot(input), DatabaseError)
  })
}

for (const field of ['userId', 'customerRole', 'branchId', 'pricingType', 'policyVersion']) {
  test('V2 exige campo comercial ' + field, () => {
    const input = snapshot('B2C')
    delete input.commercial[field]
    assert.throws(() => mapOrderSnapshot(input), DatabaseError)
    input.commercial[field] = null
    assert.throws(() => mapOrderSnapshot(input), DatabaseError)
  })
}
for (const commercial of [undefined, null, [], 'commercial']) {
  test('V2 rechaza estructura comercial ausente/incompatible: ' + String(commercial), () => {
    assert.throws(() => mapOrderSnapshot({ ...snapshot('B2C'), commercial }), DatabaseError)
  })
}
for (const branchId of ['san_jose', 'alajuela', 'cartago', 'heredia']) {
  test('conserva branch literal histórica sin consultar stock: ' + branchId, () => {
    const input = snapshot('B2C')
    input.commercial.branchId = branchId
    assert.deepEqual(mapOrderSnapshot(input), input)
  })
}
for (const value of [null, true, 0, '2', 3, [2]]) {
  test('no degrada versión incompatible a V1: ' + JSON.stringify(value), () => {
    assert.throws(() => mapOrderSnapshot({ ...snapshot(), contractVersion: value }), DatabaseError)
  })
}
test('un contexto V2 sin su discriminante no se interpreta como una Order V1', () => {
  const input = snapshot('B2C')
  delete input.contractVersion
  assert.throws(() => mapOrderSnapshot(input), DatabaseError)
})
for (const [index, input] of [null, [], 'jsonb', {}, { ...snapshot(), buyer: null }, { ...snapshot(), items: [] },
  { ...snapshot(), totals: { ...snapshot().totals, subtotal: '99999.995' } }].entries()) {
  test('JSONB incompleto/incompatible produce DatabaseError sanitizado: caso ' + index, () => {
    assert.throws(() => mapOrderSnapshot(input), error => error instanceof DatabaseError
      && error.kind === 'transaction' && error.cause === undefined && !error.message.includes('99999.995'))
  })
}

for (const role of [undefined, 'B2C', 'B2B']) {
  test('Payment Replay preserva el snapshot histórico válido: ' + (role ?? 'V1'), async t => {
    const h = paymentDatabase(t), input = snapshot(role)
    h.orders.set(input.id, orderToRow(input, userFor(role)))
    const payments = new PaymentService(h.orderStore, { process: async request => ({ result: request.scenario }) }, h.payments)
    const historical = await payments.process(input.id, paymentRequest('PAYMENT_DECLINED'), owner.id)
    await payments.process(input.id, paymentRequest('PAYMENT_APPROVED', 'retry'), owner.id)
    const restarted = new PaymentService(h.orderStore, { process: async () => assert.fail('Replay no ejecuta Sandbox.') }, new PostgreSQLPaymentStore(h.orderStore, h.db))
    const before = h.calls.length
    assert.deepEqual(await restarted.process(input.id, paymentRequest('PAYMENT_ERROR'), owner.id), historical)
    assert.equal(h.orders.get(input.id).order_status, 'CONFIRMED')
    assert.equal(historical.order.orderStatus, 'PENDING')
    assert.deepEqual(historical.order.commercial, input.commercial)
    assert.deepEqual(historical.order.totals, input.totals)
    assert.deepEqual(historical.order.termsAcceptance, input.termsAcceptance)
    assert.equal(h.calls.slice(before).some(call => /^(UPDATE|INSERT|COMMIT)/.test(call.text)), false)
  })
}

test('Payment rechaza un snapshot comercial corrupto con 503 sin tocar Order, Attempt ni Sandbox', async t => {
  const h = paymentDatabase(t), input = snapshot('B2B')
  h.orders.set(input.id, orderToRow(input, userFor('B2B')))
  let executions = 0
  const payments = new PaymentService(h.orderStore, { process: async request => { executions++; return { result: request.scenario } } }, h.payments)
  const original = await payments.process(input.id, paymentRequest('PAYMENT_DECLINED'), owner.id)
  const beforeOrders = structuredClone(h.orders), beforeAttempts = structuredClone(h.attempts), before = h.calls.length
  h.state.corruptAttempt = row => ({ ...row, order_snapshot: { ...row.order_snapshot,
    commercial: { ...row.order_snapshot.commercial, company: { id: 123, name: 'PRIVATE_COMPANY' } } } })
  await assert.rejects(payments.process(input.id, paymentRequest('PAYMENT_APPROVED'), owner.id), error => {
    assert.ok(error instanceof PaymentPersistenceError)
    assert.equal(error.status, 503); assert.equal(error.code, 'UNEXPECTED_ERROR')
    assert.equal(error.cause, undefined)
    assert.doesNotMatch(error.message + JSON.stringify(error), /PRIVATE_COMPANY|123|password|certificate/)
    return true
  })
  assert.equal(executions, 1)
  assert.deepEqual(h.orders, beforeOrders); assert.deepEqual(h.attempts, beforeAttempts)
  assert.equal(h.calls.slice(before).some(call => /^(UPDATE|INSERT|COMMIT)/.test(call.text)), false)
  assert.equal(h.calls.at(-1).text, 'ROLLBACK')
  h.state.corruptAttempt = undefined
  assert.deepEqual(await payments.process(input.id, paymentRequest('PAYMENT_ERROR'), owner.id), original)
})

test('Recovery mantiene outcome unknown si el histórico no se puede validar tras COMMIT incierto', async t => {
  const h = paymentDatabase(t), input = snapshot('B2B')
  h.orders.set(input.id, orderToRow(input, userFor('B2B')))
  h.state.commit = 'confirmed'
  h.state.corruptAttempt = row => ({ ...row, order_snapshot: { ...row.order_snapshot,
    commercial: { ...row.order_snapshot.commercial, company: {} } } })
  let executions = 0
  const payments = new PaymentService(h.orderStore, { process: async request => { executions++; return { result: request.scenario } } }, h.payments)
  await assert.rejects(payments.process(input.id, paymentRequest(), owner.id), error => error instanceof PaymentPersistenceError
    && error.status === 503 && error.outcome === 'unknown')
  assert.equal(executions, 1)
  assert.equal(h.orders.get(input.id).order_status, 'CONFIRMED')
  assert.equal(h.attempts.size, 1)
  assert.equal(h.calls.filter(call => call.text.startsWith('INSERT INTO commerce.payment_attempts')).length, 1)
  assert.equal(h.calls.filter(call => call.text.startsWith('UPDATE commerce.orders')).length, 1)
  h.state.corruptAttempt = undefined
  assert.equal((await payments.process(input.id, paymentRequest(), owner.id)).result, 'PAYMENT_APPROVED')
  assert.equal(executions, 1)
})
