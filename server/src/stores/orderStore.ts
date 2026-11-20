/** Contrato async de Orders. La composición comercial permanece explícitamente In-Memory hasta CN-59. */
import { randomUUID } from 'node:crypto'
import type { Order } from '../types/order.js'
import type { ResolvedUser } from '../types/user.js'
import type { AdminOrderEntry, AdminOrderFilters, AdminOrderOwner, AdminOrderSort } from '../types/adminOrder.js'
import { matchesAdminFilters } from '../domain/adminOrderQuery.js'
import { orderIdentity, requireCompatible, requireOrderOwner } from '../domain/orderIdentity.js'

export interface OrderCreationContext {
  idempotencyKey: string
  canonicalPayload: string
  canonicalVersion: 1 | 2
  user: ResolvedUser
}

export type OrderBuilder = (id: string, signal?: AbortSignal) => Promise<Order>

/** Página de Orders de un propietario; total cuenta todas las Orders de ese propietario. */
export interface OwnerOrdersPage {
  orders: Order[]
  total: number
}

/** Orden estable del historial: createdAt descendente y, ante empates, id ascendente. */
export function compareHistoryOrder(first: Pick<Order, 'createdAt' | 'id'>, second: Pick<Order, 'createdAt' | 'id'>): number {
  const byDate = Date.parse(second.createdAt) - Date.parse(first.createdAt)
  if (byDate !== 0) return byDate
  return first.id < second.id ? -1 : first.id > second.id ? 1 : 0
}

/** Página global administrativa (CN-66); total cuenta todas las Orders que cumplen los filtros. */
export interface AdminOrdersPageResult {
  entries: AdminOrderEntry[]
  total: number
}

export interface OrderStore {
  createOrReplay(context: OrderCreationContext, build: OrderBuilder): Promise<Order>
  findById(id: string): Promise<Order | undefined>
  findByIdForOwner(id: string, ownerId: string): Promise<Order | undefined>
  /** Consulta paginada filtrada por propietario en la persistencia; nunca filtra un listado global. */
  listByOwner(ownerId: string, offset: number, limit: number): Promise<OwnerOrdersPage>
  findByIdempotencyKey(key: string, ownerId: string): Promise<Order | undefined>
  update(order: Order, ownerId: string): Promise<Order | undefined>
  /** CN-66: consulta global Read-Only; filtra, ordena por createdAt y pagina en la persistencia. */
  listAll(filters: AdminOrderFilters, sort: AdminOrderSort, offset: number, limit: number): Promise<AdminOrdersPageResult>
  /** CN-66: estado actual de Orders identificadas por el índice; omite IDs inexistentes y conserva el orden recibido. */
  findEntriesByIds(ids: string[]): Promise<AdminOrderEntry[]>
  /** CN-66: Orders con revisiones pendientes de indexar; null si el almacenamiento no las registra. */
  countPendingIndex(): Promise<number | null>
}

/** Conserva copias defensivas y fixtures legacy sin propietario; nunca asigna estos últimos a otro usuario. */
export class InMemoryOrderStore implements OrderStore {
  private readonly orders = new Map<string, { snapshot: Order; ownerId?: string; canonicalPayload?: string; user?: ResolvedUser }>()
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

  async listByOwner(ownerId: string, offset: number, limit: number): Promise<OwnerOrdersPage> {
    // Las Orders sin propietario verificable nunca coinciden con un ownerId y quedan fuera del historial.
    const owned = ownerId ? [...this.orders.values()].filter(entry => entry.ownerId === ownerId).map(entry => entry.snapshot) : []
    owned.sort(compareHistoryOrder)
    return { orders: owned.slice(offset, offset + limit).map(order => structuredClone(order)), total: owned.length }
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

  /** Copia defensiva con la identidad registrada; los fixtures legacy sin propietario se informan con userId null. */
  private entry(value: { snapshot: Order; ownerId?: string; user?: ResolvedUser }): AdminOrderEntry {
    const role = value.user?.role ?? value.snapshot.commercial?.customerRole
    const owner: AdminOrderOwner = { userId: value.ownerId ?? null, displayName: value.user?.displayName ?? null,
      customerRole: role === 'B2C' || role === 'B2B' ? role : null,
      ...(value.user?.role === 'B2B' ? { company: { ...value.user.company } } : {}) }
    return { order: structuredClone(value.snapshot), owner }
  }

  async listAll(filters: AdminOrderFilters, sort: AdminOrderSort, offset: number, limit: number): Promise<AdminOrdersPageResult> {
    const matching = [...this.orders.values()].map(value => this.entry(value)).filter(entry => matchesAdminFilters(entry, filters))
    matching.sort((first, second) => sort === 'oldest' ? -compareHistoryOrder(first.order, second.order) || (first.order.id < second.order.id ? -1 : 1)
      : compareHistoryOrder(first.order, second.order))
    return { entries: matching.slice(offset, offset + limit), total: matching.length }
  }

  async findEntriesByIds(ids: string[]): Promise<AdminOrderEntry[]> {
    return ids.flatMap(id => { const value = this.orders.get(id); return value ? [this.entry(value)] : [] })
  }

  async countPendingIndex(): Promise<number | null> { return null }
}

/** No depende de DATABASE_URL ni importa la implementación PostgreSQL. */
export const orderStore = new InMemoryOrderStore()
