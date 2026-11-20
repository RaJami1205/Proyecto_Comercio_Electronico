/**
 * Consulta administrativa global de Orders (CN-66), exclusivamente de lectura.
 * PostgreSQL (o el store seleccionado) es la fuente autoritativa; Algolia solo identifica Orders para búsquedas por texto
 * y su resultado se completa con el estado actual persistido. No modifica Orders, Payments ni Idempotency.
 */
import { getAlgoliaOrdersClient } from '../config/algolia.js'
import { getAlgoliaOrdersConfig, isAlgoliaOrdersIndexConfigured } from '../config/env.js'
import { parseAdminOrderQuery, toAdminOrderSummary, type AdminOrderQuery } from '../domain/adminOrderQuery.js'
import { OrderError } from '../domain/orderError.js'
import { buildOrderIndexFilters } from '../domain/orderIndexQuery.js'
import { commerceStores } from '../stores/commerceStores.js'
import type { OrderStore } from '../stores/orderStore.js'
import type { AdminOrderFilters, AdminOrderPage } from '../types/adminOrder.js'

/** Coincidencia del índice orders con los estados indexados, para detectar un índice desactualizado. */
export interface AdminOrderSearchHit {
  id: string
  orderStatus?: unknown
  paymentStatus?: unknown
}

export interface AdminOrderSearch {
  search(q: string, filters: AdminOrderFilters, page: number, pageSize: number): Promise<{ hits: AdminOrderSearchHit[]; total: number }>
}

type OrdersSearchClient = Pick<ReturnType<typeof getAlgoliaOrdersClient>, 'searchSingleIndex'>

function searchUnavailable(): OrderError {
  return new OrderError(503, 'ORDER_SEARCH_UNAVAILABLE', 'La búsqueda de órdenes no está disponible. Usa los filtros, que consultan las órdenes persistidas.')
}

/** Los fallos de persistencia se informan como consulta no disponible, sin mensajes de creación ni detalles internos. */
function queryUnavailable(error: unknown): never {
  if (error instanceof OrderError && error.status !== 503) throw error
  if (error instanceof OrderError && error.code === 'ORDER_SEARCH_UNAVAILABLE') throw error
  throw new OrderError(503, 'ORDER_QUERY_UNAVAILABLE', 'No se pudieron consultar las órdenes en este momento.')
}

/** Adaptador del SDK v5 limitado al índice orders y a lecturas; los filtros se validan antes de construirse. */
export function createAlgoliaOrderSearch(
  getClient: () => OrdersSearchClient = getAlgoliaOrdersClient,
  getIndexName: () => string = () => getAlgoliaOrdersConfig().indexName,
  configured: () => boolean = isAlgoliaOrdersIndexConfigured,
): AdminOrderSearch {
  return {
    async search(q, filters, page, pageSize) {
      if (!configured()) throw searchUnavailable()
      try {
        const response = await getClient().searchSingleIndex<Record<string, unknown>>({
          indexName: getIndexName(),
          searchParams: {
            query: q, page: page - 1, hitsPerPage: pageSize,
            filters: buildOrderIndexFilters({ userId: filters.userId, customerRole: filters.customerRole, branchId: filters.branchId,
              orderStatus: filters.orderStatus, paymentStatus: filters.paymentStatus }),
            attributesToRetrieve: ['orderStatus', 'paymentStatus'], attributesToHighlight: [],
          },
        })
        if (!Array.isArray(response.hits) || typeof response.nbHits !== 'number' || !Number.isSafeInteger(response.nbHits)) throw searchUnavailable()
        return {
          hits: response.hits.map(hit => ({ id: String(hit.objectID), orderStatus: hit.orderStatus, paymentStatus: hit.paymentStatus })),
          total: response.nbHits,
        }
      } catch {
        // Ni el mensaje del SDK ni la configuración llegan a la respuesta.
        throw searchUnavailable()
      }
    },
  }
}

export class AdminOrderService {
  constructor(private readonly store: OrderStore = commerceStores.orders, private readonly search: AdminOrderSearch = createAlgoliaOrderSearch()) {}

  /** Sin texto consulta la persistencia; con texto busca en el índice orders y relee el estado actual. */
  async list(rawQuery: Record<string, unknown>): Promise<AdminOrderPage> {
    const query = parseAdminOrderQuery(rawQuery)
    if (!query.q) return this.listFromStore(query)
    // El índice no filtra por número ni ID exactos y su ranking es por fecha descendente.
    if (query.filters.orderId !== undefined || query.filters.orderNumber !== undefined) {
      throw new OrderError(400, 'INVALID_ORDER_FILTER', 'La búsqueda por texto no se combina con orderId ni orderNumber.')
    }
    if (query.sort !== 'newest') throw new OrderError(400, 'INVALID_ORDER_FILTER', 'La búsqueda por texto se ordena de la más reciente a la más antigua.')
    return this.searchIndex(query)
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

  /**
   * El índice es eventualmente consistente: cada coincidencia se relee del store, las inexistentes se omiten y se
   * marca indexOutdated cuando el estado indexado difiere del actual. Puede omitir Orders aún no indexadas.
   */
  private async searchIndex(query: AdminOrderQuery): Promise<AdminOrderPage> {
    const { hits, total } = await this.search.search(query.q, query.filters, query.page, query.pageSize)
    try {
      const [entries, pendingIndexOrders] = await Promise.all([this.store.findEntriesByIds(hits.map(hit => hit.id)), this.store.countPendingIndex()])
      const indexed = new Map(hits.map(hit => [hit.id, hit]))
      const orders = entries.map(entry => {
        const hit = indexed.get(entry.order.id)
        const outdated = hit !== undefined && (hit.orderStatus !== entry.order.orderStatus || hit.paymentStatus !== entry.order.paymentStatus)
        return { ...toAdminOrderSummary(entry), ...(outdated ? { indexOutdated: true } : {}) }
      })
      return {
        orders, page: query.page, pageSize: query.pageSize, total, hasMore: query.offset + hits.length < total,
        source: 'algolia', pendingIndexOrders, missingFromStore: hits.length - entries.length,
      }
    } catch (error) { return queryUnavailable(error) }
  }
}

export const adminOrderService = new AdminOrderService()
