/** Datos sintéticos compartidos por Unit/Integration; nunca resuelve productos/usuarios externos. */
import { calculateOrderTotals } from '../../dist/domain/orderCalculations.js'

export const owner = { id: 'owner-a', displayName: 'Cliente ficticio', role: 'B2C' }
export function orderFixture(id = 'order-a') {
  const items = [{ productId: 'p', name: 'Producto', image: '', unitPrice: 49999.9975, quantity: 2, lineSubtotal: 99999.995 }]
  return { id, orderNumber: 'CN-2026-' + id.toUpperCase(), createdAt: '2026-10-12T12:00:00.000Z',
    buyer: { fullName: 'Cliente ficticio', email: 'test@example.com', phone: '88888888' },
    delivery: { province: 'San José', canton: 'Central', address: 'Ficticia' }, items, totals: calculateOrderTotals(items),
    currency: 'CRC', orderStatus: 'PENDING', paymentStatus: 'PENDING',
    termsAcceptance: { accepted: true, version: '2026-10-lab4-v1', acceptedAt: '2026-10-12T12:00:00.000Z' } }
}
export const paymentRequest = (scenario = 'PAYMENT_APPROVED', idempotencyKey = 'attempt') => ({ scenario, idempotencyKey })
export const creationContext = (key, canonicalPayload = 'canonical-v1') => ({ user: owner, idempotencyKey: key, canonicalVersion: 1, canonicalPayload })
