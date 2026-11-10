/** Frontera unknown/Payment: el resultado y el snapshot pertenecen al intento original. */
import { DatabaseError } from '../db/databaseError.js'
import { isPaymentScenario } from '../domain/paymentValidation.js'
import { mapOrderSnapshot, orderTimestamp, rowRecord } from './orderRowMapper.js'
import type { PaymentAttempt } from './paymentStore.js'

export function mapPaymentRow(value: unknown): PaymentAttempt {
  const row = rowRecord(value)
  if (typeof row.order_id !== 'string' || !row.order_id.trim()
    || typeof row.idempotency_key !== 'string' || !row.idempotency_key.trim()
    || !isPaymentScenario(row.scenario) || !isPaymentScenario(row.result)) throw new DatabaseError('transaction')
  const order = mapOrderSnapshot(row.order_snapshot)
  const status = { PAYMENT_APPROVED: 'APPROVED', PAYMENT_DECLINED: 'DECLINED', PAYMENT_ERROR: 'ERROR' } as const
  if (order.id !== row.order_id || order.paymentStatus !== status[row.result]
    || order.orderStatus !== (row.result === 'PAYMENT_APPROVED' ? 'CONFIRMED' : 'PENDING')) throw new DatabaseError('transaction')
  return { orderId: row.order_id, idempotencyKey: row.idempotency_key, scenario: row.scenario,
    payment: { result: row.result, processedAt: orderTimestamp(row.processed_at), order } }
}
