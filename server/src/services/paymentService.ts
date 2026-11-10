/** Valida Payment Sandbox; delega exclusión, Replay y commit conjunto en la persistencia seleccionada. */
import { DatabaseError } from '../db/databaseError.js'
import { OrderError } from '../domain/orderError.js'
import { isPaymentScenario, validateProcessPaymentRequest } from '../domain/paymentValidation.js'
import type { OrderStore } from '../stores/orderStore.js'
import { commerceStores } from '../stores/commerceStores.js'
import { InMemoryPaymentStore, type PaymentStore } from '../stores/paymentStore.js'
import type { PaymentResult } from '../types/payment.js'
import type { PaymentStatus } from '../types/order.js'
import { PaymentSandboxService, type PaymentSandbox } from './paymentSandboxService.js'

export class PaymentService {
  private readonly persistence: PaymentStore

  /** Recibe el store de Orders y el Sandbox que resolverá los intentos de pago. */
  constructor(
    private readonly store: OrderStore = commerceStores.orders,
    private readonly sandbox: PaymentSandbox = new PaymentSandboxService(),
    persistence?: PaymentStore,
  ) {
    this.persistence = persistence ?? (store === commerceStores.orders ? commerceStores.payments : new InMemoryPaymentStore(store))
    if (!this.persistence.isFor(store)) throw new DatabaseError('configuration')
  }

  /** Valida el intento, recupera replay o bloquea la Order mientras procesa y guarda su resultado autoritativo. */
  async process(orderId: string, value: unknown, ownerId: string): Promise<PaymentResult> {
    const request = validateProcessPaymentRequest(value)
    if (!this.persistence.isFor(this.store)) throw new DatabaseError('configuration')
    return this.persistence.processOrReplay({ ...request, orderId, ownerId }, async order => {
      if (order.orderStatus === 'CONFIRMED' || order.paymentStatus === 'APPROVED') {
        throw new OrderError(409, 'ORDER_ALREADY_CONFIRMED', 'La orden ya fue confirmada y no admite otro pago.')
      }
      const result = await this.sandbox.process({
        orderId: order.id, amount: order.totals.total, currency: order.currency, scenario: request.scenario,
      })
      if (!isPaymentScenario(result?.result)) throw new Error('Respuesta interna inválida del Sandbox.')
      const statuses: Record<typeof result.result, PaymentStatus> = {
        PAYMENT_APPROVED: 'APPROVED', PAYMENT_DECLINED: 'DECLINED', PAYMENT_ERROR: 'ERROR',
      }
      // Solo cambian estados: el snapshot conserva datos, importes y Terms Acceptance originales.
      return { result: result.result, processedAt: new Date().toISOString(), order: {
        ...order,
        paymentStatus: statuses[result.result],
        orderStatus: result.result === 'PAYMENT_APPROVED' ? 'CONFIRMED' : 'PENDING',
      } }
    })
  }
}

export const paymentService = new PaymentService()
