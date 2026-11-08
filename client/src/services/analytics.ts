/** Analytics local por identidad; ningún fallo de validación/storage debe bloquear comercio. */
import type { AnalyticsAggregateSnapshot, AnalyticsCounters, AnalyticsEvent, AnalyticsEventInput, AnalyticsStorageStatus } from '../types/analytics'

const STORAGE_PREFIX = 'cibernova:analytics:v2:'
const LEGACY_PREFIX = 'cibernova:analytics:v1:'
const SCHEMA_VERSION = 2
const MAX_EVENTS = 500
export const RECENTLY_VIEWED_LIMIT = 10
const changedEvent = 'cibernova:analytics-changed'
const counterByType: Record<AnalyticsEvent['type'], keyof AnalyticsCounters> = {
  SESSION_STARTED: 'sessions', SEARCH_PERFORMED: 'searches', PRODUCT_VIEWED: 'productViews',
  CART_ITEM_ADDED: 'cartAdds', CHECKOUT_STARTED: 'checkouts', PURCHASE_COMPLETED: 'purchases',
}

/** Snapshot de un scope. Los contadores y las referencias de compras sobreviven al truncamiento del log. */
interface AnalyticsState {
  schemaVersion: 2
  userId: string | null
  events: AnalyticsEvent[]
  counters: AnalyticsCounters
  recentProductIds: string[]
  completedOrderIds: string[]
}

const memory = new Map<string, AnalyticsState>()
const pending = new Map<string, AnalyticsEvent[]>()
const jobs = new Map<string, Promise<void>>()
// Resultado de IO por scope; no forma parte del snapshot persistido ni del contrato de eventos.
const writeOutcomes = new Map<string, 'persisted' | 'failed'>()
/** Inicializa los seis acumulados independientes de un scope. */
const emptyCounters = (): AnalyticsCounters => ({ sessions: 0, searches: 0, productViews: 0, cartAdds: 0, checkouts: 0, purchases: 0 })
/** Crea colecciones propias para una identidad sin historial disponible. */
const emptyState = (userId: string | null): AnalyticsState => ({ schemaVersion: SCHEMA_VERSION, userId,
  events: [], counters: emptyCounters(), recentProductIds: [], completedOrderIds: [] })
/** Codifica el ID para que incluso un usuario llamado anonymous tenga su propia clave. */
const scopeFor = (userId: string | null) => userId === null ? 'anonymous' : 'user:' + encodeURIComponent(userId)
/** Exige texto no vacío y sin espacios exteriores en los identificadores. */
const text = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.trim() === value
/** Admite un ID válido o null para actividad anónima. */
const owner = (value: unknown): value is string | null => value === null || text(value)
/** Reconoce objetos con campos inspeccionables y excluye arrays. */
const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
/** Exige exactamente los campos permitidos por el contrato recibido. */
const keys = (value: Record<string, unknown>, expected: string[]) => Object.keys(value).length === expected.length && expected.every(key => Object.hasOwn(value, key))

/** Verifica fechas UTC por conversión de ida y vuelta para detectar fechas normalizadas por Date. */
function timestamp(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/.test(value) || !Number.isFinite(Date.parse(value))) return false
  const iso = new Date(value).toISOString()
  return value === iso || value === iso.replace('.000Z', 'Z')
}

/** Proyecta metadata permitida: ni TypeScript ni datos recuperados autorizan campos extra. */
function parseInput(value: unknown): AnalyticsEventInput | null {
  if (!record(value) || !keys(value, ['type', 'occurredAt', 'metadata']) || !timestamp(value.occurredAt) || !record(value.metadata)) return null
  const metadata = value.metadata, occurredAt = value.occurredAt
  switch (value.type) {
    case 'SESSION_STARTED': return keys(metadata, ['role']) && (metadata.role === 'B2C' || metadata.role === 'B2B' || metadata.role === 'ADMIN')
      ? { type: value.type, occurredAt, metadata: { role: metadata.role } } : null
    case 'SEARCH_PERFORMED': return keys(metadata, ['source']) && (metadata.source === 'catalog' || metadata.source === 'recent')
      ? { type: value.type, occurredAt, metadata: { source: metadata.source } } : null
    case 'PRODUCT_VIEWED': return keys(metadata, ['productId']) && text(metadata.productId)
      ? { type: value.type, occurredAt, metadata: { productId: metadata.productId } } : null
    case 'CART_ITEM_ADDED': return keys(metadata, ['productId', 'quantity']) && text(metadata.productId)
      && typeof metadata.quantity === 'number' && Number.isSafeInteger(metadata.quantity) && metadata.quantity > 0
      ? { type: value.type, occurredAt, metadata: { productId: metadata.productId, quantity: metadata.quantity } } : null
    case 'CHECKOUT_STARTED': return keys(metadata, []) ? { type: value.type, occurredAt, metadata: {} } : null
    case 'PURCHASE_COMPLETED': return keys(metadata, ['orderId']) && text(metadata.orderId)
      ? { type: value.type, occurredAt, metadata: { orderId: metadata.orderId } } : null
    default: return null
  }
}

/** Valida el envelope v2 contra su owner o adapta un evento v1 con el ID estable de migración. */
function parseEvent(value: unknown, userId: string | null, legacyId?: string): AnalyticsEvent | null {
  if (!record(value)) return null
  if (!legacyId && (!keys(value, ['eventId', 'type', 'occurredAt', 'userId', 'schemaVersion', 'metadata'])
    || value.schemaVersion !== SCHEMA_VERSION || value.userId !== userId || !text(value.eventId))) return null
  const input = parseInput(legacyId ? value : { type: value.type, occurredAt: value.occurredAt, metadata: value.metadata })
  return input ? { ...input, schemaVersion: SCHEMA_VERSION, userId, eventId: legacyId ?? String(value.eventId) } : null
}

/** Valida listas de referencias únicas antes de restaurar historial o compras. */
function idList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(text) && new Set(value).size === value.length
}

/** Hidrata v2 o adapta v1 en memoria. Contrasta el log retenido con los acumulados y las referencias de Orders. */
function parseState(value: unknown, userId: string | null, legacy = false): AnalyticsState | null {
  if (!record(value) || !keys(value, legacy ? ['events', 'counters', 'recentProductIds', 'completedOrderIds']
    : ['schemaVersion', 'userId', 'events', 'counters', 'recentProductIds', 'completedOrderIds'])) return null
  if (!legacy && (value.schemaVersion !== SCHEMA_VERSION || value.userId !== userId)) return null
  if (!Array.isArray(value.events) || value.events.length > MAX_EVENTS || !record(value.counters)
    || !keys(value.counters, Object.values(counterByType)) || !idList(value.recentProductIds)
    || value.recentProductIds.length > RECENTLY_VIEWED_LIMIT || !idList(value.completedOrderIds)) return null
  const counters = emptyCounters()
  for (const key of Object.values(counterByType)) {
    const count = value.counters[key]
    if (typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0) return null
    counters[key] = count
  }
  const events: AnalyticsEvent[] = []
  const retained = emptyCounters(), eventIds = new Set<string>(), purchaseIds = new Set<string>()
  for (const [index, raw] of value.events.entries()) {
    const event = parseEvent(raw, userId, legacy ? 'legacy:' + scopeFor(userId) + ':' + index + ':' + (record(raw) ? String(raw.occurredAt) : '') : undefined)
    if (!event || eventIds.has(event.eventId)) return null
    eventIds.add(event.eventId)
    retained[counterByType[event.type]]++
    if (event.type === 'PURCHASE_COMPLETED') {
      if (purchaseIds.has(event.metadata.orderId) || !value.completedOrderIds.includes(event.metadata.orderId)) return null
      purchaseIds.add(event.metadata.orderId)
    }
    events.push(event)
  }
  if (counters.purchases !== value.completedOrderIds.length || Object.values(counterByType).some(key => counters[key] < retained[key])) return null
  return { schemaVersion: SCHEMA_VERSION, userId, events, counters,
    recentProductIds: [...value.recentProductIds], completedOrderIds: [...value.completedOrderIds] }
}

/** Una versión desconocida/corrupta queda intacta; los eventos nuevos siguen solo en memoria. */
function storedState(userId: string | null): { state: AnalyticsState; writable: boolean; status: 'valid' | 'missing' | 'incompatible' | 'unavailable' } {
  const fallback = emptyState(userId)
  try {
    const scope = scopeFor(userId)
    const raw = window.localStorage.getItem(STORAGE_PREFIX + scope)
    const serialized = raw ?? window.localStorage.getItem(LEGACY_PREFIX + scope)
    if (serialized === null) return { state: fallback, writable: true, status: 'missing' }
    let state: AnalyticsState | null
    try { state = parseState(JSON.parse(serialized), userId, raw === null) } catch { state = null }
    return { state: state ?? fallback, writable: state !== null, status: state ? 'valid' : 'incompatible' }
  } catch { return { state: fallback, writable: false, status: 'unavailable' } }
}

/** Hidrata el scope en su primera lectura y reutiliza la copia de esta pestaña. */
function readState(userId: string | null): AnalyticsState {
  const scope = scopeFor(userId)
  const cached = memory.get(scope)
  if (cached) return cached
  const state = storedState(userId).state
  memory.set(scope, state)
  return state
}

/** Aplica una acción al acumulado y limita el log a 500 eventos. Cada visita mueve el producto al inicio del historial y cada Order cuenta una sola vez por scope. */
function applyEvent(state: AnalyticsState, event: AnalyticsEvent): AnalyticsState {
  if (state.events.some(saved => saved.eventId === event.eventId)
    || (event.type === 'PURCHASE_COMPLETED' && state.completedOrderIds.includes(event.metadata.orderId))) return state
  const counter = counterByType[event.type]
  if (state.counters[counter] === Number.MAX_SAFE_INTEGER) return state
  const recentProductIds = event.type === 'PRODUCT_VIEWED'
    ? [event.metadata.productId, ...state.recentProductIds.filter(id => id !== event.metadata.productId)].slice(0, RECENTLY_VIEWED_LIMIT)
    : state.recentProductIds
  return { ...state, events: [...state.events, event].slice(-MAX_EVENTS),
    counters: { ...state.counters, [counter]: state.counters[counter] + 1 }, recentProductIds,
    completedOrderIds: event.type === 'PURCHASE_COMPLETED' ? [...state.completedOrderIds, event.metadata.orderId] : state.completedOrderIds }
}

/** Avisa a los observadores de esta ventana tras cambios de actividad o persistencia. */
function notify() {
  try { window.dispatchEvent(new Event(changedEvent)) } catch { /* Observadores opcionales. */ }
}

/** Solo el lock exclusivo permite read/modify/write. Sin Web Locks no se arriesga persistencia concurrente. */
function scheduleWrite(userId: string | null) {
  const scope = scopeFor(userId)
  if (jobs.has(scope) || typeof navigator === 'undefined' || !navigator.locks) return
  const locks = navigator.locks
  let committed = false
  const job = Promise.resolve().then(() => locks.request(STORAGE_PREFIX + scope, () => {
    const buffered = pending.get(scope)
    if (!buffered?.length) return
    const latest = storedState(userId)
    if (!latest.writable) return
    const state = buffered.reduce(applyEvent, latest.state)
    const serialized = JSON.stringify(state)
    const changed = JSON.stringify(memory.get(scope)) !== serialized
    window.localStorage.setItem(STORAGE_PREFIX + scope, serialized)
    pending.delete(scope)
    memory.set(scope, state)
    writeOutcomes.set(scope, 'persisted')
    committed = true
    if (changed) notify()
  })).catch(() => {
    // Quota, permisos o lock rechazado: mantener el buffer y la copia en memoria.
    writeOutcomes.set(scope, 'failed')
  })
    .finally(() => {
      jobs.delete(scope)
      if (committed && pending.has(scope)) scheduleWrite(userId)
      // También notificar cuando solo cambió la persistencia, sin cambiar los contadores.
      notify()
    })
  jobs.set(scope, job)
}

/** Acepta el input tipado, valida runtime y crea un envelope estable; el negocio nunca espera IO. */
export function trackEvent(input: AnalyticsEventInput, userId: string | null = null): void {
  try {
    if (typeof window === 'undefined' || !owner(userId)) return
    const parsed = parseInput(input)
    if (!parsed) return
    const current = readState(userId)
    if (parsed.type === 'PURCHASE_COMPLETED' && current.completedOrderIds.includes(parsed.metadata.orderId)) return
    const event: AnalyticsEvent = { ...parsed, userId, schemaVersion: SCHEMA_VERSION, eventId: crypto.randomUUID() }
    const next = applyEvent(current, event)
    if (next === current) return
    const scope = scopeFor(userId)
    pending.set(scope, [...(pending.get(scope) ?? []), event])
    memory.set(scope, next)
    scheduleWrite(userId)
    notify()
  } catch { /* Datos inválidos, APIs ausentes o errores inesperados de Analytics son no bloqueantes. */ }
}

/** Permite verificar/finalizar las escrituras ya programadas; nunca se requiere para comprar. */
export async function flushAnalytics(): Promise<void> {
  while (jobs.size) await Promise.allSettled([...jobs.values()])
}

/** Devuelve una copia de los acumulados individuales, incluidos los anteriores al log retenido. */
export function getAnalyticsCounters(userId: string | null = null): AnalyticsCounters {
  try { return owner(userId) ? { ...readState(userId).counters } : emptyCounters() } catch { return emptyCounters() }
}

/** Entrega IDs únicos del scope, del producto visto más recientemente al más antiguo. */
export function getRecentlyViewedProductIds(userId: string | null = null): string[] {
  try { return owner(userId) ? [...readState(userId).recentProductIds] : [] } catch { return [] }
}

/** Proyecta copias validadas de los eventos retenidos del scope solicitado. */
export function getAnalyticsEvents(userId: string | null = null): AnalyticsEvent[] {
  try {
    if (!owner(userId)) return []
    return readState(userId).events.flatMap(event => {
      const projected = parseEvent(event, userId)
      return projected ? [projected] : []
    })
  } catch { return [] }
}

/** Conserva eventos aún no persistidos al reconciliar una notificación de otra pestaña. */
export function refreshAnalyticsState(userId: string | null = null): void {
  try {
    if (!owner(userId)) return
    const scope = scopeFor(userId), buffered = pending.get(scope)
    if (!buffered?.length) memory.delete(scope)
    else {
      const latest = storedState(userId)
      if (latest.writable) memory.set(scope, buffered.reduce(applyEvent, latest.state))
    }
  } catch { /* Preservar la copia local ante storage no disponible. */ }
}

/** Distingue snapshots persistidos, IO pendiente y actividad en memoria sin modificar storage. */
export function getAnalyticsStorageStatus(userId: string | null = null): AnalyticsStorageStatus {
  try {
    if (typeof window === 'undefined' || !owner(userId) || typeof navigator === 'undefined' || !navigator.locks) return 'memory-only'
    window.localStorage.getItem(STORAGE_PREFIX + scopeFor(userId))
  } catch { return 'memory-only' }
  if (!storedState(userId).writable) return 'incompatible'
  const scope = scopeFor(userId)
  if (writeOutcomes.get(scope) === 'failed') return 'memory-only'
  return jobs.has(scope) ? 'pending' : 'persistent'
}

/** Un único nombre canónico evita aliases de IDs y mantiene Anonymous separado. */
function ownerForScope(scope: string): string | null | undefined {
  if (scope === 'anonymous') return null
  if (!scope.startsWith('user:')) return undefined
  try {
    const userId = decodeURIComponent(scope.slice(5))
    return text(userId) && scopeFor(userId) === scope ? userId : undefined
  } catch { return undefined }
}

/** Extrae el scope canónico de una clave v1 o v2 para identificar cambios de Analytics. */
function scopeFromStorageKey(key: string): string | undefined {
  const prefix = [STORAGE_PREFIX, LEGACY_PREFIX].find(value => key.startsWith(value))
  if (!prefix) return undefined
  const scope = key.slice(prefix.length)
  return ownerForScope(scope) !== undefined ? scope : undefined
}

/** Indica si un StorageEvent corresponde a un scope reconocido del navegador. */
export function isAnalyticsStorageKey(key: string): boolean {
  return scopeFromStorageKey(key) !== undefined
}

/** Lee todos los scopes disponibles del origen, sin persistir otro total ni reasignar eventos.
 * La memoria de otras pestañas solo está disponible después de sincronizarse con localStorage.
 */
export function getAggregateAnalyticsSnapshot(): AnalyticsAggregateSnapshot {
  try {
    const scopes = new Set([...memory.keys(), ...pending.keys()])
    const invalidKeys = new Set<string>()
    const persistence = { pending: false, memoryOnly: false, unavailable: false, excludedScopes: 0 }
    try {
      const storage = window.localStorage
      for (let index = 0; index < storage.length; index++) {
        const key = storage.key(index)
        if (key === null || ![STORAGE_PREFIX, LEGACY_PREFIX].some(prefix => key.startsWith(prefix))) continue
        const scope = scopeFromStorageKey(key)
        if (scope === undefined) invalidKeys.add(key)
        else scopes.add(scope)
      }
    } catch { persistence.unavailable = true; persistence.memoryOnly = true }
    persistence.excludedScopes = invalidKeys.size
    const counters = { productViews: 0, searches: 0, cartAdds: 0, purchases: 0 }
    /** La unión de Order IDs evita contar dos veces una compra registrada en scopes distintos. */
    const completedOrders = new Set<string>()
    for (const scope of scopes) {
      const userId = ownerForScope(scope)
      if (userId === undefined) { persistence.excludedScopes++; continue }
      const latest = storedState(userId)
      const buffered = pending.get(scope) ?? []
      // La misma reconciliación del Core, en lectura: nunca sumar memoria + storage.
      const state = latest.writable ? buffered.reduce(applyEvent, latest.state)
        : memory.get(scope) ?? buffered.reduce(applyEvent, latest.state)
      if (latest.status === 'incompatible') persistence.excludedScopes++
      if (latest.status === 'unavailable') { persistence.unavailable = true; persistence.memoryOnly = true }
      if (buffered.length && (writeOutcomes.get(scope) === 'failed' || !jobs.has(scope))) persistence.memoryOnly = true
      if (jobs.has(scope)) persistence.pending = true
      for (const key of ['productViews', 'searches', 'cartAdds'] as const) {
        counters[key] += state.counters[key]
        if (!Number.isSafeInteger(counters[key]) || counters[key] < 0) return { status: 'error' }
      }
      for (const orderId of state.completedOrderIds) completedOrders.add(orderId)
    }
    counters.purchases = completedOrders.size
    if (!Number.isSafeInteger(counters.purchases)) return { status: 'error' }
    return { status: 'ready', counters, persistence }
  } catch { return { status: 'error' } }
}

export const analyticsStorage = { keyPrefix: STORAGE_PREFIX, legacyKeyPrefix: LEGACY_PREFIX,
  schemaVersion: SCHEMA_VERSION, maxEvents: MAX_EVENTS, changedEvent }
