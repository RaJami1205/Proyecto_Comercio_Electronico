/**
 * Proyecta Orders persistidas hacia el índice Algolia orders. No contiene reglas de Pricing, Inventory,
 * creación de Orders ni aprobación de pagos: solo lee revisiones de PostgreSQL y escribe su representación.
 */
import { isDeepStrictEqual } from 'node:util'
import { getAlgoliaOrdersClient } from '../config/algolia.js'
import { ConfigurationError, getAlgoliaOrdersConfig } from '../config/env.js'
import { OrderIndexError } from '../domain/orderIndexError.js'
import { toOrderIndexRecord } from '../domain/orderIndexMapper.js'
import type { OrderIndexStore } from '../stores/postgreSQLOrderIndexStore.js'
import type { OrderIndexRecord } from '../types/orderIndex.js'

type OrdersIndexClient = Pick<ReturnType<typeof getAlgoliaOrdersClient>, 'partialUpdateObject' | 'waitForTask' | 'getObjects'>

export interface OrderIndexWriter {
  /** Publica solo revisiones superiores y resuelve únicamente tras verificar todos los atributos esperados. */
  save(record: OrderIndexRecord): Promise<void>
  /** Proyección remota completa, sin metadatos de búsqueda; solo los registros ausentes se omiten. */
  readRecords(orderIds: string[]): Promise<Map<string, Record<string, unknown>>>
  /** Revisión positiva válida; null significa versión inválida. Solo los registros ausentes se omiten del Map. */
  readVersions(orderIds: string[]): Promise<Map<string, number | null>>
}

export type OrderIndexSyncOutcome = 'synced' | 'up-to-date' | 'busy' | 'not-found' | 'pending'

export interface OrderIndexReconcileReport { pending: number; valid: number; invalid: number; synced: number; failed: number; skipped: number }
export interface OrderIndexVerifyReport { checked: number; drift: number; repaired: number; failed: number }

const GET_OBJECTS_BATCH = 1000
const ORDER_INDEX_ATTRIBUTES = Object.keys({
  objectID: true, orderNumber: true, userId: true, customerRole: true, branchId: true,
  createdAt: true, createdAtTimestamp: true, orderStatus: true, paymentStatus: true,
  total: true, currency: true, indexVersion: true, contractVersion: true, company: true,
} satisfies Record<keyof OrderIndexRecord, boolean>)

/** Misma comparación para publicación y mantenimiento: ausencia opcional no equivale a null. */
function matchesProjection(expected: OrderIndexRecord, actual: Record<string, unknown> | undefined): boolean {
  if (!actual) return false
  const projection = Object.fromEntries(ORDER_INDEX_ATTRIBUTES.map(field => [field, actual[field]]))
  const company = actual.company
  if (company !== null && typeof company === 'object' && !Array.isArray(company)) {
    // Solo id/name forman parte de Company; los metadatos ajenos al DTO no participan.
    projection.company = { id: 'id' in company ? company.id : undefined, name: 'name' in company ? company.name : undefined }
  }
  return isDeepStrictEqual(projection, { ...expected, company: expected.company })
}

function remoteVersion(record: Record<string, unknown>): number | null {
  const value = record.indexVersion
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : null
}

/** Lectura compartida sin caché; una respuesta incompleta nunca se interpreta como ausencia. */
async function readOrderIndexRecords(client: OrdersIndexClient, indexName: string, orderIds: string[]): Promise<Map<string, Record<string, unknown>>> {
  const records = new Map<string, Record<string, unknown>>()
  for (let start = 0; start < orderIds.length; start += GET_OBJECTS_BATCH) {
    const ids = orderIds.slice(start, start + GET_OBJECTS_BATCH)
    const response = await client.getObjects<Record<string, unknown>>({
      requests: ids.map(objectID => ({ indexName, objectID, attributesToRetrieve: ORDER_INDEX_ATTRIBUTES })),
    }, { cacheable: false })
    if (!Array.isArray(response.results) || response.results.length !== ids.length) throw new OrderIndexError('unavailable')
    for (const [position, result] of response.results.entries()) {
      if (result === null) continue
      if (!result || typeof result !== 'object' || Array.isArray(result)) throw new OrderIndexError('unavailable')
      records.set(ids[position], result)
    }
  }
  return records
}

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
      const { objectID, indexVersion, ...attributes } = record
      // IncrementSet condiciona TODA la actualización: una revisión inferior o igual no cambia ningún atributo.
      // https://www.algolia.com/doc/guides/sending-and-managing-data/send-and-update-your-data/in-depth/handling-concurrency-with-versioning
      const response = await client.partialUpdateObject({ indexName, objectID, createIfNotExists: true,
        attributesToUpdate: { ...attributes, indexVersion: { _operation: 'IncrementSet', value: indexVersion } } })
      const taskID = response.taskID
      if (taskID !== undefined) {
        if (typeof taskID !== 'number' || !Number.isSafeInteger(taskID) || taskID < 0) throw new OrderIndexError('unavailable')
        try { await client.waitForTask({ indexName, taskID, maxRetries: 20 }) }
        catch {
          // Una operación descartada puede no publicarse; un timeout tampoco demuestra que la escritura falló.
        }
      }
      // Con o sin taskID, solo la lectura posterior aporta evidencia de los atributos efectivamente publicados.
      const published = await readOrderIndexRecords(client, indexName, [objectID])
      if (!matchesProjection(record, published.get(objectID))) throw new OrderIndexError('unavailable')
    },
    async readRecords(orderIds) {
      return readOrderIndexRecords(getClient(), getIndexName(), orderIds)
    },
    async readVersions(orderIds) {
      const records = await readOrderIndexRecords(getClient(), getIndexName(), orderIds)
      return new Map([...records].map(([id, record]) => [id, remoteVersion(record)]))
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
    // El lease coordina workers; IncrementSet protege Algolia incluso si un worker continúa después de su vencimiento.
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

  /** Repara ausentes/anteriores; las versiones inválidas o superiores no reconocidas se reportan sin escrituras. */
  async verifyRemote({ limit = 1000, dryRun = true }: { limit?: number; dryRun?: boolean } = {}): Promise<OrderIndexVerifyReport> {
    const report: OrderIndexVerifyReport = { checked: 0, drift: 0, repaired: 0, failed: 0 }
    let afterId: string | undefined
    while (report.checked < limit) {
      const page = await this.store.listSynced(afterId, Math.min(GET_OBJECTS_BATCH, limit - report.checked))
      if (!page.length) break
      afterId = page[page.length - 1].id
      report.checked += page.length
      let remote: Map<string, Record<string, unknown>>
      try { remote = await this.writer.readRecords(page.map(entry => entry.id)) }
      catch (error) { throw toOrderIndexError(error) }
      for (const entry of page) {
        const record = remote.get(entry.id)
        const revision = record ? remoteVersion(record) : undefined
        if (revision === null) {
          report.drift++
          report.failed++
          this.log(`Inconsistencia del índice orders para la Order ${entry.id}: versión remota inválida; requiere intervención controlada.`)
          continue
        }
        if (record && revision !== undefined) {
          // La página es solo un cursor: la revisión y los atributos se contrastan con una lectura vigente.
          const current = await this.store.readSource(entry.id)
          if (current === undefined) throw new OrderIndexError('persistence')
          if (revision > current.indexVersion) {
            report.drift++
            report.failed++
            this.log(`Inconsistencia del índice orders para la Order ${entry.id}: versión remota ${revision} superior a PostgreSQL ${current.indexVersion}; requiere intervención controlada.`)
            continue
          }
          if (revision === current.indexVersion) {
            if (matchesProjection(toOrderIndexRecord(current), record)) continue
            report.drift++
            report.failed++
            this.log(`Inconsistencia del índice orders para la Order ${entry.id}: contenido remoto incompatible con la revisión autoritativa; requiere intervención controlada.`)
            continue
          }
        }
        report.drift++
        if (dryRun) continue
        await this.store.markStale(entry.id, revision ?? 0)
        const outcome = await this.syncWithRetry(entry.id)
        if (outcome === 'synced' || outcome === 'up-to-date') report.repaired++
        else report.failed++
      }
    }
    return report
  }
}
