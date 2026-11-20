/**
 * Consulta administrativa global de Orders (CN-66), exclusivamente de lectura.
 * PostgreSQL (o el store seleccionado) es la fuente autoritativa del listado; no modifica Orders, Payments ni Idempotency.
 */
import { parseAdminOrderQuery, toAdminOrderSummary, type AdminOrderQuery } from '../domain/adminOrderQuery.js'
import { OrderError } from '../domain/orderError.js'
import { commerceStores } from '../stores/commerceStores.js'
import type { OrderStore } from '../stores/orderStore.js'
import type { AdminOrderPage } from '../types/adminOrder.js'

/** Los fallos de persistencia se informan como consulta no disponible, sin mensajes de creación ni detalles internos. */
function queryUnavailable(error: unknown): never {
  if (error instanceof OrderError && error.status !== 503) throw error
  throw new OrderError(503, 'ORDER_QUERY_UNAVAILABLE', 'No se pudieron consultar las órdenes en este momento.')
}

export class AdminOrderService {
  constructor(private readonly store: OrderStore = commerceStores.orders) {}

  /** Valida filtros y pagina en la persistencia, de la más reciente a la más antigua por defecto. */
  async list(rawQuery: Record<string, unknown>): Promise<AdminOrderPage> {
    const query = parseAdminOrderQuery(rawQuery)
    return this.listFromStore(query)
  }

  /** Incluye Orders pendientes de indexar: el listado general nunca depende de Algolia. */
  private async listFromStore(query: AdminOrderQuery): Promise<AdminOrderPage> {
    try {
      const [result, pendingIndexOrders] = await Promise.all([
        this.store.listAll(query.filters, query.sort, query.offset, query.pageSize),
        this.store.countPendingIndex(),
      ])
      return {
        orders: result.entries.map(toAdminOrderSummary), page: query.page, pageSize: query.pageSize, total: result.total,
        hasMore: query.offset + result.entries.length < result.total, source: 'postgresql', pendingIndexOrders,
      }
    } catch (error) { return queryUnavailable(error) }
  }
}

export const adminOrderService = new AdminOrderService()
