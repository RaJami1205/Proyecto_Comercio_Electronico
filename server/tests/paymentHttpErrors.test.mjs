/** Propagación HTTP de incertidumbre sin abrir PostgreSQL ni llamar Algolia. */
import test from 'node:test'
import assert from 'node:assert/strict'
import app from '../dist/app.js'
import { paymentService } from '../dist/services/paymentService.js'
import { PaymentPersistenceError } from '../dist/domain/paymentPersistenceError.js'
import { mockUserDirectory, testIdentityHeaders } from './helpers/identity.mjs'

test('Payment Persistence 503 sanitizado y outcome unknown sobreviven al Controller', async t => {
  mockUserDirectory(t)
  let reason = 'unknown'
  t.mock.method(paymentService.persistence, 'processOrReplay', async () => { throw new PaymentPersistenceError(reason) })
  const server = app.listen(0, '127.0.0.1')
  await new Promise(resolve => server.once('listening', resolve))
  t.after(() => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())))
  for (reason of ['unknown', 'unavailable', 'timeout', 'deadlock']) {
    const response = await fetch('http://127.0.0.1:' + server.address().port + '/api/orders/example/payment', {
      method: 'POST', headers: { ...testIdentityHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ scenario: 'PAYMENT_APPROVED', idempotencyKey: 'same-key' }),
    })
    assert.equal(response.status, 503)
    const body = await response.json()
    assert.equal(body.error.code, 'UNEXPECTED_ERROR')
    assert.equal(body.error.outcome, reason === 'unknown' ? 'unknown' : undefined)
    assert.deepEqual(Object.keys(body.error).sort(), reason === 'unknown' ? ['code', 'message', 'outcome'] : ['code', 'message'])
  }
})
