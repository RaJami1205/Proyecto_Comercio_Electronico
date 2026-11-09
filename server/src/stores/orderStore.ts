/** Almacena copias de Orders y sus claves de creación en memoria; los datos se pierden al reiniciar el proceso. */
import type { Order } from '../types/order.js'
import { OrderError } from '../domain/orderError.js'

export interface OrderStore {
  create(order: Order, idempotencyKey: string, ownerId?: string): Order
  findById(id: string): Order | undefined
  findByIdForOwner(id: string, ownerId: string): Order | undefined
  findByIdempotencyKey(key: string): Order | undefined
  update(order: Order): Order | undefined
}

/** Los snapshots se copian para que consumidores no muten el estado almacenado. */
export class InMemoryOrderStore implements OrderStore {
  // Asociación temporal no durable. El owner queda fuera del DTO y se conserva en cada update.
  private readonly orders = new Map<string, { snapshot: Order; ownerId?: string }>()
  private readonly keys = new Map<string, string>()

  /** Asocia snapshot y propietario en una operación síncrona. La ausencia de ownerId representa una Order legacy. */
  create(order: Order, idempotencyKey: string, ownerId?: string): Order {
    const existing = this.findByIdempotencyKey(idempotencyKey)
    if (existing) {
      if (this.orders.get(existing.id)?.ownerId !== ownerId) throw new OrderError(404, 'ORDER_NOT_FOUND', 'La orden solicitada no existe.')
      return existing
    }
    if (this.orders.has(order.id)) throw new Error('Identificador duplicado de orden.')
    this.orders.set(order.id, { snapshot: structuredClone(order), ownerId })
    this.keys.set(idempotencyKey, order.id)
    return structuredClone(order)
  }
  /** Devuelve una copia de la Order identificada o undefined si no está almacenada. */
  findById(id: string): Order | undefined {
    const order = this.orders.get(id)
    return order ? structuredClone(order.snapshot) : undefined
  }
  /** Solo entrega snapshots con propietario verificable, incluidas las consultas de Replay. */
  findByIdForOwner(id: string, ownerId: string): Order | undefined {
    const entry = this.orders.get(id)
    return ownerId && entry?.ownerId === ownerId ? structuredClone(entry.snapshot) : undefined
  }
  /** Resuelve la clave de creación y devuelve una copia de su Order, si existe. */
  findByIdempotencyKey(key: string): Order | undefined {
    const id = this.keys.get(key)
    return id ? this.findById(id) : undefined
  }
  /** Reemplaza una Order existente por una copia del snapshot recibido; devuelve undefined si no existe. */
  update(order: Order): Order | undefined {
    const entry = this.orders.get(order.id)
    if (!entry) return undefined
    this.orders.set(order.id, { ...entry, snapshot: structuredClone(order) })
    return structuredClone(order)
  }
}

/** Instancia compartida por creación, consulta y procesamiento de pagos. */
export const orderStore = new InMemoryOrderStore()
