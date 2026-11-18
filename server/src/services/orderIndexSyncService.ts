/**
 * Proyecta Orders persistidas hacia el índice Algolia orders. No contiene reglas de Pricing, Inventory,
 * creación de Orders ni aprobación de pagos: solo lee revisiones de PostgreSQL y escribe su representación.
 */
import { getAlgoliaOrdersClient } from '../config/algolia.js'
import { ConfigurationError, getAlgoliaOrdersConfig } from '../config/env.js'
import { OrderIndexError } from '../domain/orderIndexError.js'
import { toOrderIndexRecord } from '../domain/orderIndexMapper.js'
import type { OrderIndexStore } from '../stores/postgreSQLOrderIndexStore.js'
import type { OrderIndexRecord } from '../types/orderIndex.js'

type OrdersIndexClient = Pick<ReturnType<typeof getAlgoliaOrdersClient>, 'addOrUpdateObject' | 'waitForTask' | 'getObjects'>

export interface OrderIndexWriter {
  /** Agrega o reemplaza el registro por objectID; repetirlo nunca crea duplicados. */
  save(record: OrderIndexRecord): Promise<void>
  /** Devuelve indexVersion de los registros presentes en Algolia; los ausentes no aparecen en el Map. */
  readVersions(orderIds: string[]): Promise<Map<string, number>>
}

export type OrderIndexSyncOutcome = 'synced' | 'up-to-date' | 'busy' | 'not-found' | 'pending'

export interface OrderIndexReconcileReport { pending: number; valid: number; invalid: number; synced: number; failed: number; skipped: number }
export interface OrderIndexVerifyReport { checked: number; drift: number; repaired: number; failed: number }

const GET_OBJECTS_BATCH = 1000

/** Traduce errores del SDK y de configuración a categorías sin mensajes, URLs ni credenciales. */
export function toOrderIndexError(error: unknown): OrderIndexError {
  if (error instanceof OrderIndexError) return error
  if (error instanceof ConfigurationError) return new OrderIndexError('configuration')
  const status = error !== null && typeof error === 'object' && 'status' in error ? error.status : undefined
  if (typeof status === 'number' && status >= 400 && status < 500 && status !== 408 && status !== 429) {
    return new OrderIndexError('rejected')
  }
  // Timeouts, hosts inalcanzables, 429 y 5xx: la escritura pudo o no aplicarse; el reintento es idempotente.
  return new OrderIndexError('unavailable')
}

/** Adaptador del SDK v5 limitado al índice orders configurado. */
export function createAlgoliaOrderIndexWriter(
  getClient: () => OrdersIndexClient = getAlgoliaOrdersClient,
  getIndexName: () => string = () => getAlgoliaOrdersConfig().indexName,
): OrderIndexWriter {
  return {
    async save(record) {
      const indexName = getIndexName()
      const client = getClient()
      const response = await client.addOrUpdateObject({ indexName, objectID: record.objectID, body: record })
      // Confirma que el registro es consultable antes de marcar la revisión como sincronizada.
      if (response.taskID !== undefined) await client.waitForTask({ indexName, taskID: response.taskID, maxRetries: 20 })
    },
    async readVersions(orderIds) {
      const indexName = getIndexName()
      const client = getClient()
      const versions = new Map<string, number>()
      for (let start = 0; start < orderIds.length; start += GET_OBJECTS_BATCH) {
        const ids = orderIds.slice(start, start + GET_OBJECTS_BATCH)
        const response = await client.getObjects<Record<string, unknown>>({
          requests: ids.map(objectID => ({ indexName, objectID, attributesToRetrieve: ['indexVersion'] })),
        })
        response.results.forEach((result, position) => {
          const value = result?.indexVersion
          if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) versions.set(ids[position], value)
          // Un registro sin indexVersion válido se trata como ausente para forzar su reescritura.
        })
      }
      return versions
    },
  }
}

export interface OrderIndexSyncOptions {
  leaseMs?: number
  retryDelaysMs?: number[]
  maxPasses?: number
  log?: (message: string) => void
}

export class OrderIndexSyncService {
  private readonly leaseMs: number
  private readonly retryDelaysMs: number[]
  private readonly maxPasses: number
  private readonly log: (message: string) => void
  private readonly inFlight = new Set<Promise<unknown>>()

  /** Recibe el registro de revisiones de PostgreSQL y el escritor del índice. */
  constructor(private readonly store: OrderIndexStore, private readonly writer: OrderIndexWriter, options: OrderIndexSyncOptions = {}) {
    // El lease supera los timeouts del cliente y la espera de la tarea para no solapar escrituras de la misma Order.
    this.leaseMs = options.leaseMs ?? 120_000
    this.retryDelaysMs = options.retryDelaysMs ?? [500, 2000]
    this.maxPasses = options.maxPasses ?? 3
    this.log = options.log ?? (message => console.error(message))
  }

  /** Escribe la revisión vigente y repite mientras PostgreSQL registre una revisión posterior a la escrita. */
  async syncOrder(orderId: string): Promise<OrderIndexSyncOutcome> {
    let wrote = false
    for (let pass = 0; pass < this.maxPasses; pass++) {
      const claim = await this.store.claim(orderId, this.leaseMs)
      if (claim.status !== 'claimed') return wrote && claim.status === 'up-to-date' ? 'synced' : claim.status
      let record: OrderIndexRecord
      try {
        record = toOrderIndexRecord(claim.source)
        await this.writer.save(record)
      } catch (error) {
        const failure = toOrderIndexError(error)
        // Si no se puede registrar el fallo, el lease expira y la revisión sigue pendiente.
        if (failure.kind !== 'persistence') await this.store.release(orderId, claim.token, failure.kind).catch(() => undefined)
        throw failure
      }
      wrote = true
      if (!(await this.store.complete(orderId, claim.token, record.indexVersion)).pending) return 'synced'
    }
    return 'pending'
  }

  /** Reintenta solo fallos temporales; un fallo final deja la revisión pendiente para Reconciliation. */
  async syncWithRetry(orderId: string): Promise<OrderIndexSyncOutcome | 'failed'> {
    for (let attempt = 0; ; attempt++) {
      try { return await this.syncOrder(orderId) }
      catch (error) {
        const failure = toOrderIndexError(error)
        if (!failure.retryable || attempt >= this.retryDelaysMs.length) {
          this.log(`Sincronización de la Order ${orderId} con Algolia pendiente (${failure.kind}).`)
          return 'failed'
        }
        await new Promise(resolve => setTimeout(resolve, this.retryDelaysMs[attempt]))
      }
    }
  }

  /** Inicia la sincronización después del commit sin bloquear ni hacer fallar la operación comercial. */
  notify(orderId: string): void {
    const task = this.syncWithRetry(orderId).catch(() => 'failed' as const)
    this.inFlight.add(task)
    void task.finally(() => this.inFlight.delete(task))
  }

  /** Espera las sincronizaciones iniciadas por notify; útil para pruebas y cierres ordenados. */
  async idle(): Promise<void> {
    while (this.inFlight.size) await Promise.allSettled([...this.inFlight])
  }

  /** Recorre Orders pendientes por id; en dry-run solo valida sus registros sin escribir en Algolia ni PostgreSQL. */
  async reconcile({ limit = 100, dryRun = true }: { limit?: number; dryRun?: boolean } = {}): Promise<OrderIndexReconcileReport> {
    const report: OrderIndexReconcileReport = { pending: 0, valid: 0, invalid: 0, synced: 0, failed: 0, skipped: 0 }
    let afterId: string | undefined
    while (report.pending < limit) {
      const page = await this.store.listPending(afterId, Math.min(100, limit - report.pending))
      if (!page.length) break
      for (const entry of page) {
        afterId = entry.id
        report.pending++
        let valid = entry.source !== null
        if (entry.source) { try { toOrderIndexRecord(entry.source) } catch { valid = false } }
        if (valid) report.valid++
        else report.invalid++
        if (dryRun || !valid) continue
        const outcome = await this.syncWithRetry(entry.id)
        if (outcome === 'synced' || outcome === 'up-to-date') report.synced++
        else if (outcome === 'failed') report.failed++
        else report.skipped++
      }
    }
    return report
  }

  /** Compara indexVersion en Algolia con PostgreSQL; con dryRun false vuelve a sincronizar ausentes y obsoletas. */
  async verifyRemote({ limit = 1000, dryRun = true }: { limit?: number; dryRun?: boolean } = {}): Promise<OrderIndexVerifyReport> {
    const report: OrderIndexVerifyReport = { checked: 0, drift: 0, repaired: 0, failed: 0 }
    let afterId: string | undefined
    while (report.checked < limit) {
      const page = await this.store.listSynced(afterId, Math.min(GET_OBJECTS_BATCH, limit - report.checked))
      if (!page.length) break
      afterId = page[page.length - 1].id
      report.checked += page.length
      let remote: Map<string, number>
      try { remote = await this.writer.readVersions(page.map(entry => entry.id)) }
      catch (error) { throw toOrderIndexError(error) }
      for (const entry of page) {
        const remoteVersion = remote.get(entry.id) ?? 0
        if (remoteVersion >= entry.indexVersion) continue
        report.drift++
        if (dryRun) continue
        await this.store.markStale(entry.id, remoteVersion)
        const outcome = await this.syncWithRetry(entry.id)
        if (outcome === 'synced' || outcome === 'up-to-date') report.repaired++
        else report.failed++
      }
    }
    return report
  }
}
