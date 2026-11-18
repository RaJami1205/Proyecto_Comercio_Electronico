/** Composición del Server: la proyección orders solo se activa con PostgreSQL y el índice configurado. */
import { isAlgoliaOrdersIndexConfigured, serverConfig } from '../config/env.js'
import { database } from '../db/pool.js'
import { PostgreSQLOrderIndexStore } from '../stores/postgreSQLOrderIndexStore.js'
import { createAlgoliaOrderIndexWriter, OrderIndexSyncService } from './orderIndexSyncService.js'

/** Punto de integración posterior a una escritura confirmada; nunca lanza ni espera a Algolia. */
export interface OrderIndexNotifier {
  notify(orderId: string): void
}

let service: OrderIndexSyncService | undefined

/**
 * Sin PostgreSQL no existen revisiones persistentes que sincronizar. Sin configuración de Algolia las revisiones
 * quedan pendientes en PostgreSQL hasta que una Reconciliation posterior las procese.
 */
export function getOrderIndexSyncService(): OrderIndexSyncService | undefined {
  if (serverConfig.commerceStoreMode !== 'postgresql' || !isAlgoliaOrdersIndexConfigured()) return undefined
  service ??= new OrderIndexSyncService(new PostgreSQLOrderIndexStore(database), createAlgoliaOrderIndexWriter())
  return service
}

export const orderIndexNotifier: OrderIndexNotifier = {
  notify(orderId) {
    try { getOrderIndexSyncService()?.notify(orderId) }
    catch { console.error('No se pudo iniciar la sincronización del índice orders.') }
  },
}
