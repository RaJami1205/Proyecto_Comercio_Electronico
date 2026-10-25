/** Coordina pagos simulados, estados de Order, replay de resultados y exclusión de pagos concurrentes en este proceso. */
import { OrderError } from '../domain/orderError.js'
import { isPaymentScenario, validateProcessPaymentRequest } from '../domain/paymentValidation.js'
import { orderStore, type OrderStore } from '../stores/orderStore.js'
import type { PaymentResult } from '../types/payment.js'
import type { PaymentStatus } from '../types/order.js'
import { PaymentSandboxService, type PaymentSandbox } from './paymentSandboxService.js'

export class PaymentService {
  private readonly paymentLocks = new Set<string>()
  // Las claves se aíslan por Order: nunca se devuelve el pago de otra compra.
  private readonly results = new Map<string, Map<string, PaymentResult>>()

  /** Recibe el store de Orders y el Sandbox que resolverá los intentos de pago. */
  constructor(
    private readonly store: OrderStore = orderStore,
    private readonly sandbox: PaymentSandbox = new PaymentSandboxService(),
  ) {}

  /** Valida el intento, recupera replay o bloquea la Order mientras procesa y guarda su resultado autoritativo. */
  async process(orderId: string, value: unknown): Promise<PaymentResult> {
    const request = validateProcessPaymentRequest(value)
    const order = this.store.findById(orderId)
    if (!order) throw new OrderError(404, 'ORDER_NOT_FOUND', 'La orden solicitada no existe.')

    // Un replay devuelve el snapshot histórico, incluso tras un Retry o una aprobación.
    const existing = this.results.get(orderId)?.get(request.idempotencyKey)
    if (existing) return structuredClone(existing)

    if (order.orderStatus === 'CONFIRMED' || order.paymentStatus === 'APPROVED') {
      throw new OrderError(409, 'ORDER_ALREADY_CONFIRMED', 'La orden ya fue confirmada y no admite otro pago.')
    }
    if (this.paymentLocks.has(orderId)) {
      throw new OrderError(409, 'PAYMENT_IN_PROGRESS', 'Ya hay un pago en proceso para esta orden.')
    }

    // La adquisición es síncrona y sucede antes del primer await.
    this.paymentLocks.add(orderId)
    try {
      const result = await this.sandbox.process({
        orderId: order.id, amount: order.totals.total, currency: order.currency, scenario: request.scenario,
      })
      if (!isPaymentScenario(result?.result)) throw new Error('Respuesta interna inválida del Sandbox.')
      const statuses: Record<typeof result.result, PaymentStatus> = {
        PAYMENT_APPROVED: 'APPROVED', PAYMENT_DECLINED: 'DECLINED', PAYMENT_ERROR: 'ERROR',
      }
      // Solo cambian estados: el snapshot conserva datos, importes y Terms Acceptance originales.
      const updated = this.store.update({
        ...order,
        paymentStatus: statuses[result.result],
        orderStatus: result.result === 'PAYMENT_APPROVED' ? 'CONFIRMED' : 'PENDING',
      })
      if (!updated) throw new OrderError(404, 'ORDER_NOT_FOUND', 'La orden solicitada no existe.')
      const payment: PaymentResult = { result: result.result, processedAt: new Date().toISOString(), order: updated }
      let orderResults = this.results.get(orderId)
      if (!orderResults) {
        orderResults = new Map<string, PaymentResult>()
        this.results.set(orderId, orderResults)
      }
      orderResults.set(request.idempotencyKey, structuredClone(payment))
      return structuredClone(payment)
    } finally {
      this.paymentLocks.delete(orderId)
    }
  }
}

export const paymentService = new PaymentService()
