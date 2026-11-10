/** Contrato async de Orders. La composición comercial permanece explícitamente In-Memory hasta CN-59. */
import { randomUUID } from 'node:crypto'
import type { Order } from '../types/order.js'
import type { B2CUser } from '../types/user.js'
import { orderIdentity, requireCompatible, requireOrderOwner } from '../domain/orderIdentity.js'

export interface OrderCreationContext {
  idempotencyKey: string
  canonicalPayload: string
  canonicalVersion: 1
  user: B2CUser
}

export type OrderBuilder = (id: string, signal?: AbortSignal) => Promise<Order>

export interface OrderStore {
  createOrReplay(context: OrderCreationContext, build: OrderBuilder): Promise<Order>
  findById(id: string): Promise<Order | undefined>
  findByIdForOwner(id: string, ownerId: string): Promise<Order | undefined>
  findByIdempotencyKey(key: string, ownerId: string): Promise<Order | undefined>
  update(order: Order, ownerId: string): Promise<Order | undefined>
}

/** Conserva copias defensivas y fixtures legacy sin propietario; nunca asigna estos últimos a otro usuario. */
export class InMemoryOrderStore implements OrderStore {
  private readonly orders = new Map<string, { snapshot: Order; ownerId?: string; canonicalPayload?: string; user?: B2CUser }>()
  private readonly keys = new Map<string, string>()
  private readonly pending = new Map<string, { context: OrderCreationContext; task: Promise<Order> }>()

  async createOrReplay(context: OrderCreationContext, build: OrderBuilder): Promise<Order> {
    const id = this.keys.get(context.idempotencyKey)
    const existing = id ? this.orders.get(id) : undefined
    if (existing) {
      requireOrderOwner(existing.ownerId, context.user.id)
      requireCompatible(existing.canonicalPayload ?? orderIdentity(existing.snapshot), context.canonicalPayload)
      return structuredClone(existing.snapshot)
    }
    const pending = this.pending.get(context.idempotencyKey)
    if (pending) {
      requireOrderOwner(pending.context.user.id, context.user.id)
      requireCompatible(pending.context.canonicalPayload, context.canonicalPayload)
      return structuredClone(await pending.task)
    }
    const task = Promise.resolve().then(async () => {
      const order = await build(randomUUID())
      const result = await this.create(order, context.idempotencyKey, context.user.id)
      const entry = this.orders.get(result.id)!
      entry.canonicalPayload = context.canonicalPayload
      entry.user = structuredClone(context.user)
      return result
    })
    this.pending.set(context.idempotencyKey, { context: structuredClone(context), task })
    try { return structuredClone(await task) }
    finally { this.pending.delete(context.idempotencyKey) }
  }

  /** Utilidad async de fixtures/compatibilidad In-Memory; la creación comercial usa createOrReplay. */
  async create(order: Order, idempotencyKey: string, ownerId?: string): Promise<Order> {
    const existingId = this.keys.get(idempotencyKey)
    const existing = existingId ? this.orders.get(existingId) : undefined
    if (existing) {
      if (existing.ownerId !== ownerId) requireOrderOwner(existing.ownerId, ownerId ?? '')
      return structuredClone(existing.snapshot)
    }
    if (this.orders.has(order.id)) throw new Error('Identificador duplicado de orden.')
    this.orders.set(order.id, { snapshot: structuredClone(order), ownerId })
    this.keys.set(idempotencyKey, order.id)
    return structuredClone(order)
  }

  async findById(id: string): Promise<Order | undefined> {
    const order = this.orders.get(id)
    return order ? structuredClone(order.snapshot) : undefined
  }

  async findByIdForOwner(id: string, ownerId: string): Promise<Order | undefined> {
    const entry = this.orders.get(id)
    return ownerId && entry?.ownerId === ownerId ? structuredClone(entry.snapshot) : undefined
  }

  async findByIdempotencyKey(key: string, ownerId?: string): Promise<Order | undefined> {
    const id = this.keys.get(key)
    if (id && ownerId !== undefined) requireOrderOwner(this.orders.get(id)?.ownerId, ownerId)
    return id ? this.findById(id) : undefined
  }

  async update(order: Order, ownerId?: string): Promise<Order | undefined> {
    const entry = this.orders.get(order.id)
    if (!entry || (ownerId !== undefined && entry.ownerId !== ownerId)) return undefined
    this.orders.set(order.id, { ...entry, snapshot: structuredClone(order) })
    return structuredClone(order)
  }
}

/** No depende de DATABASE_URL ni importa la implementación PostgreSQL. */
export const orderStore = new InMemoryOrderStore()
