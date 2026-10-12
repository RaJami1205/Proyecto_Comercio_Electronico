import type { Order } from '../types/order.js'

export interface OrderStore {
  create(order: Order, idempotencyKey: string): Order
  findById(id: string): Order | undefined
  findByIdempotencyKey(key: string): Order | undefined
  update(order: Order): Order | undefined
}

/** Los snapshots se copian para que consumidores no muten el estado almacenado. */
export class InMemoryOrderStore implements OrderStore {
  private readonly orders = new Map<string, Order>()
  private readonly keys = new Map<string, string>()

  create(order: Order, idempotencyKey: string): Order {
    const existing = this.findByIdempotencyKey(idempotencyKey)
    if (existing) return existing
    if (this.orders.has(order.id)) throw new Error('Identificador duplicado de orden.')
    this.orders.set(order.id, structuredClone(order))
    this.keys.set(idempotencyKey, order.id)
    return structuredClone(order)
  }
  findById(id: string): Order | undefined {
    const order = this.orders.get(id)
    return order ? structuredClone(order) : undefined
  }
  findByIdempotencyKey(key: string): Order | undefined {
    const id = this.keys.get(key)
    return id ? this.findById(id) : undefined
  }
  update(order: Order): Order | undefined {
    if (!this.orders.has(order.id)) return undefined
    this.orders.set(order.id, structuredClone(order))
    return structuredClone(order)
  }
}
