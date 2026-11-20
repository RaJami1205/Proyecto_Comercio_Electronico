/** Payment Persistence V1: keys por Order y resultados históricos independientes del estado actual. */
import { DatabaseError } from '../db/databaseError.js'
import { OrderError } from '../domain/orderError.js'
import type { Order } from '../types/order.js'
import type { PaymentResult, ProcessPaymentRequest } from '../types/payment.js'
import { InMemoryOrderStore, type OrderStore } from './orderStore.js'

export interface PaymentContext extends ProcessPaymentRequest { orderId: string; ownerId: string }
export interface PaymentAttempt {
  orderId: string
  idempotencyKey: string
  scenario: ProcessPaymentRequest['scenario']
  payment: PaymentResult
}
export type PaymentBuilder = (order: Order) => Promise<PaymentResult>
export interface PaymentStore {
  isFor(orders: OrderStore): boolean
  processOrReplay(context: PaymentContext, build: PaymentBuilder): Promise<PaymentResult>
  findByKey(orderId: string, key: string, ownerId: string): Promise<PaymentAttempt | undefined>
  findByOrder(orderId: string, ownerId: string): Promise<PaymentAttempt[]>
}

export function missingOrder(): OrderError { return new OrderError(404, 'ORDER_NOT_FOUND', 'La orden solicitada no existe.') }
export function paymentInProgress(): OrderError { return new OrderError(409, 'PAYMENT_IN_PROGRESS', 'Ya hay un pago en proceso para esta orden.') }

export class InMemoryPaymentStore implements PaymentStore {
  private readonly paymentLocks = new Set<string>()
  private readonly results = new Map<string, Map<string, PaymentAttempt>>()
  constructor(private readonly orders: OrderStore) {
    if (!(orders instanceof InMemoryOrderStore)) throw new DatabaseError('configuration')
  }
  isFor(orders: OrderStore): boolean { return this.orders === orders && orders instanceof InMemoryOrderStore }
  private async owned(orderId: string, ownerId: string): Promise<Order> {
    const order = await this.orders.findByIdForOwner(orderId, ownerId)
    if (!order) throw missingOrder()
    return order
  }
  async findByKey(orderId: string, key: string, ownerId: string): Promise<PaymentAttempt | undefined> {
    await this.owned(orderId, ownerId)
    return structuredClone(this.results.get(orderId)?.get(key.trim()))
  }
  async findByOrder(orderId: string, ownerId: string): Promise<PaymentAttempt[]> {
    await this.owned(orderId, ownerId)
    return structuredClone([...(this.results.get(orderId)?.values() ?? [])])
  }
  async processOrReplay(context: PaymentContext, build: PaymentBuilder): Promise<PaymentResult> {
    context = { ...context, idempotencyKey: context.idempotencyKey.trim() }
    const { orderId, ownerId, idempotencyKey } = context
    const existing = await this.findByKey(orderId, idempotencyKey, ownerId)
    if (existing) return existing.payment
    if (this.paymentLocks.has(orderId)) throw paymentInProgress()
    this.paymentLocks.add(orderId)
    try {
      const order = await this.owned(orderId, ownerId)
      // Una lectura demorada previa al lock puede haber coincidido con un intento ya completado.
      const replay = this.results.get(orderId)?.get(idempotencyKey)
      if (replay) return structuredClone(replay.payment)
      if (order.orderStatus === 'CONFIRMED' || order.paymentStatus === 'APPROVED') {
        throw new OrderError(409, 'ORDER_ALREADY_CONFIRMED', 'La orden ya fue confirmada y no admite otro pago.')
      }
      const built = await build(structuredClone(order))
      const updated = await this.orders.update({ ...order, orderStatus: built.order.orderStatus, paymentStatus: built.order.paymentStatus }, ownerId)
      if (!updated) throw missingOrder()
      const payment = { result: built.result, processedAt: built.processedAt, order: updated }
      let attempts = this.results.get(orderId)
      if (!attempts) { attempts = new Map(); this.results.set(orderId, attempts) }
      attempts.set(idempotencyKey, structuredClone({ orderId, idempotencyKey, scenario: context.scenario, payment }))
      return structuredClone(payment)
    } finally { this.paymentLocks.delete(orderId) }
  }
}
