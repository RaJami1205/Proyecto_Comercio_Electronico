/** CN-65: mapper, filtros, configuración, sincronización, Retry y Reconciliation con dobles, sin PostgreSQL ni Algolia reales. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { toOrderIndexRecord } from '../dist/domain/orderIndexMapper.js'
import { buildOrderIndexFilters, ORDER_INDEX_SETTINGS } from '../dist/domain/orderIndexQuery.js'
import { OrderIndexError } from '../dist/domain/orderIndexError.js'
import { ConfigurationError, getAlgoliaConfig, getAlgoliaOrdersConfig, getAlgoliaUsersConfig, isAlgoliaOrdersIndexConfigured } from '../dist/config/env.js'
import { createAlgoliaOrderIndexWriter, OrderIndexSyncService, toOrderIndexError } from '../dist/services/orderIndexSyncService.js'
import { orderIndexNotifier } from '../dist/services/orderIndexing.js'
import { OrderService } from '../dist/services/orderService.js'
import { PaymentService } from '../dist/services/paymentService.js'
import { InMemoryOrderStore } from '../dist/stores/orderStore.js'
import { PostgreSQLOrderIndexStore } from '../dist/stores/postgreSQLOrderIndexStore.js'
import { orderToRow } from '../dist/stores/orderRowMapper.js'
import { orderFixture, owner, paymentRequest } from './helpers/commerceFixtures.mjs'
import { CURRENT_TERMS_VERSION } from '../dist/domain/termsPolicy.js'

const company = { id: 'company-1', name: 'Empresa ficticia' }
const b2c = (overrides = {}) => ({ order: orderFixture('order-1'), ownerUserId: owner.id, customerRole: 'B2C', indexVersion: 1, ...overrides })
/** Fuente V2 B2B con contexto comercial persistido. */
const b2b = (overrides = {}) => {
  const order = { ...orderFixture('order-2'), contractVersion: 2, commercial: { userId: 'user-b2b-01', customerRole: 'B2B', company,
    branchId: 'san_jose', pricingType: 'WHOLESALE', policyVersion: 'CIBERNOVA-COMMERCIAL-V1' } }
  return { order, ownerUserId: 'user-b2b-01', customerRole: 'B2B', company, indexVersion: 2, ...overrides }
}

test('el mapper proyecta B2C V1 con campos explícitos e identificador estable', () => {
  const source = b2c()
  assert.deepEqual(toOrderIndexRecord(source), {
    objectID: 'order-1', orderNumber: source.order.orderNumber, userId: owner.id, customerRole: 'B2C', branchId: null,
    createdAt: '2026-10-12T12:00:00.000Z', createdAtTimestamp: Date.UTC(2026, 9, 12, 12) / 1000, orderStatus: 'PENDING', paymentStatus: 'PENDING',
    total: source.order.totals.total, currency: 'CRC', indexVersion: 1, contractVersion: 1,
  })
})

test('el mapper conserva B2B, sucursal, Company e importes sin datos personales ni de pago', () => {
  const record = toOrderIndexRecord(b2b({ order: { ...b2b().order, orderStatus: 'CONFIRMED', paymentStatus: 'APPROVED' } }))
  assert.equal(record.customerRole, 'B2B'); assert.equal(record.branchId, 'san_jose'); assert.equal(record.contractVersion, 2)
  assert.deepEqual(record.company, company)
  // El total histórico se conserva sin redondeos adicionales.
  assert.equal(record.total, b2b().order.totals.total)
  assert.equal(record.total, 112999.995)
  const serialized = JSON.stringify(record)
  for (const forbidden of ['buyer', 'delivery', 'items', 'termsAcceptance', 'test@example.com', '88888888', 'Ficticia', 'pricingType', 'card']) {
    assert.ok(!serialized.includes(forbidden), forbidden)
  }
})

test('el mapper rechaza registros que no cumplen los modelos aprobados', () => {
  const base = b2b().order
  for (const source of [
    b2c({ customerRole: 'ADMIN' }), b2c({ ownerUserId: 'bad id' }), b2c({ indexVersion: 0 }), b2c({ indexVersion: 1.5 }),
    b2c({ company }), b2b({ company: undefined }), b2b({ customerRole: 'B2C' }), b2b({ ownerUserId: 'other' }),
    b2b({ order: { ...base, commercial: { ...base.commercial, branchId: 'limon' } } }),
    b2c({ order: { ...orderFixture('order-1'), orderStatus: 'CONFIRMED' } }),
    b2c({ order: { ...orderFixture('order-1'), createdAt: 'no-date' } }),
    b2c({ order: { ...orderFixture('order-1'), totals: { ...orderFixture().totals, total: -1 } } }),
    b2c({ order: { ...orderFixture('x'.repeat(513)) } }),
    b2c({ order: { ...orderFixture('order-1'), commercial: base.commercial } }),
  ]) assert.throws(() => toOrderIndexRecord(source), { name: 'OrderIndexError', kind: 'invalid-record' })
})

test('filtros administrativos validados y settings de faceting', () => {
  assert.equal(buildOrderIndexFilters({}), '')
  assert.equal(buildOrderIndexFilters({ userId: 'user-b2b-01', customerRole: 'B2B', branchId: 'cartago', orderStatus: 'CONFIRMED',
    paymentStatus: 'APPROVED', createdFrom: '2026-11-01T00:00:00Z', createdTo: '2026-11-30T23:59:59Z' }),
  'userId:"user-b2b-01" AND customerRole:"B2B" AND branchId:"cartago" AND orderStatus:"CONFIRMED" AND paymentStatus:"APPROVED"' +
    ` AND createdAtTimestamp >= ${Date.UTC(2026, 10, 1) / 1000} AND createdAtTimestamp <= ${Date.UTC(2026, 10, 30, 23, 59, 59) / 1000}`)
  for (const query of [{ userId: 'a" OR userId:"b' }, { customerRole: 'ADMIN' }, { branchId: 'limon' }, { orderStatus: 'X' },
    { paymentStatus: 'REFUNDED' }, { createdFrom: 'ayer' }]) assert.throws(() => buildOrderIndexFilters(query), RangeError)
  for (const attribute of ['filterOnly(userId)', 'customerRole', 'branchId', 'orderStatus', 'paymentStatus']) {
    assert.ok(ORDER_INDEX_SETTINGS.attributesForFaceting.includes(attribute))
  }
  assert.ok(ORDER_INDEX_SETTINGS.searchableAttributes.includes('orderNumber'))
})

/** Reemplaza variables de entorno durante una prueba y las restaura. */
function withEnv(values, run) {
  const previous = Object.fromEntries(Object.keys(values).map(key => [key, process.env[key]]))
  const assign = entries => { for (const [key, value] of Object.entries(entries)) { if (value === undefined) delete process.env[key]; else process.env[key] = value } }
  assign(values)
  try { return run() } finally { assign(previous) }
}
const algoliaEnv = { ALGOLIA_APP_ID: 'app', ALGOLIA_API_KEY: 'search-key', ALGOLIA_INDEX_NAME: 'products', ALGOLIA_USERS_INDEX_NAME: 'users',
  ALGOLIA_ORDERS_INDEX_NAME: 'orders', ALGOLIA_ORDERS_API_KEY: 'orders-key' }

test('configuración orders independiente y sin colisiones con products ni users', () => {
  withEnv(algoliaEnv, () => {
    assert.deepEqual(getAlgoliaOrdersConfig(), { appId: 'app', apiKey: 'orders-key', indexName: 'orders' })
    assert.equal(isAlgoliaOrdersIndexConfigured(), true)
  })
  withEnv({ ...algoliaEnv, ALGOLIA_ORDERS_INDEX_NAME: undefined, ALGOLIA_ORDERS_API_KEY: undefined }, () => {
    assert.equal(isAlgoliaOrdersIndexConfigured(), false)
    assert.throws(getAlgoliaOrdersConfig, ConfigurationError)
    assert.deepEqual(getAlgoliaConfig(), { appId: 'app', apiKey: 'search-key', indexName: 'products' })
    assert.deepEqual(getAlgoliaUsersConfig(), { indexName: 'users' })
  })
  for (const name of ['products', 'products_price_asc', 'products_price_desc', 'users']) {
    withEnv({ ...algoliaEnv, ALGOLIA_ORDERS_INDEX_NAME: name }, () => assert.throws(getAlgoliaOrdersConfig, ConfigurationError))
  }
})

test('el escritor del SDK usa objectID estable, espera la tarea y lee versiones por lotes', async () => {
  const calls = []
  const record = toOrderIndexRecord(b2c())
  const writer = createAlgoliaOrderIndexWriter(() => ({
    partialUpdateObject: async request => { calls.push(['save', request]); return { taskID: 7 } },
    waitForTask: async request => { calls.push(['wait', request]) },
    getObjects: async (request, options) => {
      calls.push(['get', request, options])
      return { results: request.requests.length === 1 && request.requests[0].objectID === record.objectID ? [record]
        : request.requests.map((item, position) => position === 0 ? { indexVersion: 3 } : position === 1 ? null : { indexVersion: 'x' }) }
    },
  }), () => 'orders-test')
  await writer.save(record)
  const { objectID, indexVersion, ...attributes } = record
  assert.deepEqual(calls[0], ['save', { indexName: 'orders-test', objectID, createIfNotExists: true,
    attributesToUpdate: { ...attributes, indexVersion: { _operation: 'IncrementSet', value: indexVersion } } }])
  assert.deepEqual(calls[1], ['wait', { indexName: 'orders-test', taskID: 7, maxRetries: 20 }])
  assert.deepEqual(calls[2], ['get', { requests: [{ indexName: 'orders-test', objectID,
    attributesToRetrieve: [...Object.keys(record), 'company'] }] }, { cacheable: false }])
  const versions = await writer.readVersions(Array.from({ length: 1001 }, (_, index) => 'order-' + index))
  assert.equal(calls.filter(([kind]) => kind === 'get').length, 3)
  assert.ok(calls[3][1].requests.every(request => request.indexName === 'orders-test'
    && [...Object.keys(record), 'company'].every(field => request.attributesToRetrieve.includes(field))))
  assert.deepEqual([versions.get('order-0'), versions.has('order-1'), versions.get('order-2'), versions.get('order-1000')], [3, false, null, 3])
  assert.deepEqual(calls[3][2], { cacheable: false })
})

/** Doble de la primitiva remota: IncrementSet decide atómicamente TODOS los atributos, no solo la versión. */
function conditionalIndex() {
  const records = new Map(), tasks = new Map(), calls = []
  let taskId = 0
  const client = {
    async partialUpdateObject(request) {
      calls.push(['partial', structuredClone(request)])
      const { objectID, attributesToUpdate, createIfNotExists } = request
      const { indexVersion: operation, ...attributes } = attributesToUpdate
      assert.equal(operation._operation, 'IncrementSet')
      assert.ok(Number.isSafeInteger(operation.value) && operation.value > 0)
      const current = records.get(objectID)
      const accepted = current ? operation.value > current.indexVersion : createIfNotExists === true
      if (accepted) records.set(objectID, { ...current, ...structuredClone(attributes), objectID, indexVersion: operation.value })
      tasks.set(++taskId, accepted)
      return { taskID: taskId }
    },
    async waitForTask({ taskID }) {
      calls.push(['wait', taskID])
      // Una operación descartada puede agotar el polling sin publicarse, según el contrato de Algolia.
      if (!tasks.get(taskID)) throw new Error('Stopped waiting for an ignored task')
      return { status: 'published' }
    },
    async getObjects({ requests }, options) {
      calls.push(['get', options])
      return { results: requests.map(({ objectID, attributesToRetrieve }) => {
        const record = records.get(objectID)
        return record ? structuredClone(Object.fromEntries(attributesToRetrieve.filter(key => key in record).map(key => [key, record[key]]))) : null
      }) }
    },
  }
  const writer = createAlgoliaOrderIndexWriter(() => client, () => 'orders-test')
  return { client, records, calls, writer }
}

const quiet = { retryDelaysMs: [1, 1], log() {} }

test('IncrementSet crea ausentes, aplica revisiones superiores y descarta íntegramente las inferiores o iguales', async () => {
  const remote = conditionalIndex()
  const original = toOrderIndexRecord(b2b({ indexVersion: 1 }))
  const confirmed = { ...original, indexVersion: 2, orderStatus: 'CONFIRMED', paymentStatus: 'APPROVED' }
  await remote.writer.save(original)
  assert.deepEqual(remote.records.get(original.objectID), original)
  await remote.writer.save(confirmed)
  assert.deepEqual(remote.records.get(original.objectID), confirmed)
  await assert.rejects(remote.writer.save(original), { kind: 'unavailable' })
  assert.deepEqual(remote.records.get(original.objectID), confirmed)
  // Misma revisión con datos diferentes: la condición no debe permitir cambiar ningún atributo.
  await assert.rejects(remote.writer.save({ ...original, indexVersion: 2 }), { kind: 'unavailable' })
  assert.deepEqual(remote.records.get(original.objectID), confirmed)
  // Repetir la revisión idéntica se verifica por lectura, aunque la operación sea descartada.
  await remote.writer.save(confirmed)
  assert.equal(remote.records.size, 1)
  assert.deepEqual(remote.records.get(original.objectID), confirmed)
})

test('la confirmación comprueba cada atributo, no solo indexVersion ni la publicación de la tarea', async () => {
  const expected = toOrderIndexRecord(b2b())
  for (const field of Object.keys(expected)) {
    if (field === 'indexVersion') continue
    const remote = conditionalIndex()
    const read = remote.client.getObjects
    remote.client.getObjects = async (...args) => {
      const response = await read(...args)
      response.results[0][field] = field === 'company' ? { ...expected.company, name: 'Otra empresa' } : null
      return response
    }
    await assert.rejects(remote.writer.save(expected), { kind: 'unavailable' }, field)
  }
  for (const taskID of [-1, NaN]) {
    const remote = conditionalIndex()
    remote.client.partialUpdateObject = async () => ({ taskID })
    await assert.rejects(remote.writer.save(expected), { kind: 'unavailable' })
    assert.equal(remote.calls.length, 0, 'No se confirma una respuesta sin taskID válido.')
  }
})

test('una respuesta sin taskID solo se acepta si la lectura verifica el registro completo', async () => {
  const remote = conditionalIndex(), expected = toOrderIndexRecord(b2c())
  remote.client.partialUpdateObject = async () => ({})
  await assert.rejects(remote.writer.save(expected), { kind: 'unavailable' })
  assert.equal(remote.calls.some(([kind]) => kind === 'wait'), false)
  remote.records.set(expected.objectID, expected)
  await remote.writer.save(expected)
  assert.ok(remote.calls.every(([kind]) => kind === 'get'), 'Ninguna confirmación depende solo del acuse.')
})

test('un timeout de polling solo permite confirmar cuando la lectura demuestra el contenido completo', async () => {
  const remote = conditionalIndex()
  remote.client.waitForTask = async () => { throw new Error('Query timeout') }
  const expected = toOrderIndexRecord(b2c())
  await remote.writer.save(expected)
  assert.deepEqual(remote.records.get(expected.objectID), expected)
  remote.client.getObjects = async () => ({ results: [null] })
  await assert.rejects(remote.writer.save(expected), { kind: 'unavailable' })
})

test('dos workers: el antiguo termina después de vencer su lease y no revierte ningún atributo remoto', { timeout: 2000 }, async t => {
  const store = memoryIndexStore(), remote = conditionalIndex()
  const initial = b2b({ indexVersion: 1 }), id = initial.order.id
  store.add(initial)
  const entered = Promise.withResolvers(), resume = Promise.withResolvers()
  t.after(() => resume.resolve())
  const partial = remote.client.partialUpdateObject
  remote.client.partialUpdateObject = async request => {
    if (request.attributesToUpdate.indexVersion.value === 1) { entered.resolve(); await resume.promise }
    return partial(request)
  }
  const completions = [], complete = store.complete
  store.complete = async (...args) => { completions.push(args[2]); return complete(...args) }
  const workerA = new OrderIndexSyncService(store, remote.writer, quiet)
  const workerB = new OrderIndexSyncService(store, remote.writer, quiet)
  const oldResult = workerA.syncOrder(id).then(value => ({ value }), error => ({ error }))
  try {
    await Promise.race([entered.promise, oldResult.then(() => { throw new Error('El worker no inició la operación condicional.') })])
    assert.equal(await workerB.syncOrder(id), 'busy')
    store.bump(id, { orderStatus: 'CONFIRMED', paymentStatus: 'APPROVED' })
    store.orders.get(id).lease.expires = Date.now() - 1
    assert.equal(await workerB.syncOrder(id), 'synced')
    const expected = toOrderIndexRecord({ ...initial, indexVersion: 2,
      order: { ...initial.order, orderStatus: 'CONFIRMED', paymentStatus: 'APPROVED' } })
    assert.deepEqual(remote.records.get(id), expected)
    resume.resolve()
    assert.equal((await oldResult).error?.kind, 'unavailable', 'Descartar v1 no equivale a verificar su publicación.')
    assert.deepEqual(remote.records.get(id), expected, 'Todos los atributos de v2 permanecen íntegros.')
    assert.equal(store.orders.get(id).indexed, 2)
    assert.deepEqual(completions, [2], 'El worker antiguo nunca intenta confirmar su revisión.')
    assert.equal(remote.records.size, 1)
  } finally { resume.resolve(); await oldResult }
})

test('una respuesta de escritura perdida conserva pendientes y el Retry verifica la misma revisión sin duplicados', async () => {
  const store = memoryIndexStore(), remote = conditionalIndex(), source = b2c(), id = source.order.id
  store.add(source)
  const partial = remote.client.partialUpdateObject
  remote.client.partialUpdateObject = async request => { await partial(request); throw new Error('Response lost') }
  const service = new OrderIndexSyncService(store, remote.writer, { ...quiet, retryDelaysMs: [] })
  assert.equal(await service.syncWithRetry(id), 'failed')
  assert.equal(store.orders.get(id).indexed, 0)
  assert.equal(store.orders.get(id).lease, null)
  assert.equal(remote.records.size, 1, 'La escritura pudo publicarse pese a la respuesta perdida.')
  remote.client.partialUpdateObject = partial
  assert.equal(await service.syncOrder(id), 'synced')
  assert.equal(store.orders.get(id).indexed, 1)
  assert.equal(remote.records.size, 1)
  assert.deepEqual(remote.records.get(id), toOrderIndexRecord(source))
})

test('una lectura de verificación fallida no confirma PostgreSQL y permite Recovery', async () => {
  const store = memoryIndexStore(), remote = conditionalIndex(), source = b2c(), id = source.order.id
  store.add(source)
  const read = remote.client.getObjects
  remote.client.getObjects = async () => { throw new Error('Connection interrupted') }
  const service = new OrderIndexSyncService(store, remote.writer, quiet)
  await assert.rejects(service.syncOrder(id), { kind: 'unavailable' })
  assert.equal(store.orders.get(id).indexed, 0)
  assert.equal(store.orders.get(id).lease, null)
  remote.client.getObjects = read
  assert.equal(await service.syncOrder(id), 'synced')
  assert.deepEqual(remote.records.get(id), toOrderIndexRecord(source))
})

test('los errores de Algolia se clasifican sin conservar detalles internos', () => {
  const sdk = status => Object.assign(new Error('PRIVATE key=secret host=xyz'), { status })
  for (const [error, kind, retryable] of [
    [sdk(403), 'rejected', false], [sdk(404), 'rejected', false], [sdk(400), 'rejected', false],
    [sdk(429), 'unavailable', true], [sdk(500), 'unavailable', true], [sdk(503), 'unavailable', true],
    [Object.assign(new Error('Unreachable hosts'), { name: 'RetryError' }), 'unavailable', true],
    [new ConfigurationError('Faltan variables'), 'configuration', false],
    [new OrderIndexError('persistence'), 'persistence', true],
  ]) {
    const result = toOrderIndexError(error)
    assert.equal(result.kind, kind); assert.equal(result.retryable, retryable)
    assert.ok(!result.message.includes('secret') && !result.message.includes('PRIVATE'))
  }
})

/** Doble del registro de revisiones con la misma semántica que las sentencias PostgreSQL. */
function memoryIndexStore() {
  const orders = new Map()
  const store = {
    orders,
    add(source, indexed = 0) { orders.set(source.order.id, { source: structuredClone(source), version: source.indexVersion, indexed, lease: null, failures: 0, lastError: null }) },
    bump(id, change) { const entry = orders.get(id); Object.assign(entry.source.order, change); entry.version++ },
    async claim(id, leaseMs) {
      const entry = orders.get(id)
      if (!entry) return { status: 'not-found' }
      if (entry.indexed >= entry.version) return { status: 'up-to-date' }
      if (entry.lease && entry.lease.expires > Date.now()) return { status: 'busy' }
      const token = Math.random().toString(36).slice(2)
      entry.lease = { token, expires: Date.now() + leaseMs }
      return { status: 'claimed', token, source: { ...structuredClone(entry.source), indexVersion: entry.version } }
    },
    async complete(id, token, version) {
      const entry = orders.get(id)
      if (!entry || entry.lease?.token !== token || entry.indexed >= version || version > entry.version) return { pending: true }
      Object.assign(entry, { indexed: version, lease: null, failures: 0, lastError: null })
      return { pending: entry.indexed < entry.version }
    },
    async release(id, token, failure) {
      const entry = orders.get(id)
      if (entry?.lease?.token === token) Object.assign(entry, { lease: null, failures: entry.failures + 1, lastError: failure })
    },
    async listPending(afterId, limit) {
      return [...orders.entries()].filter(([id, entry]) => entry.indexed < entry.version && (afterId === undefined || id > afterId))
        .sort(([a], [b]) => a < b ? -1 : 1).slice(0, limit)
        .map(([id, entry]) => ({ id, indexVersion: entry.version, source: { ...structuredClone(entry.source), indexVersion: entry.version } }))
    },
    async listSynced(afterId, limit) {
      return [...orders.entries()].filter(([id, entry]) => entry.indexed === entry.version && (afterId === undefined || id > afterId))
        .sort(([a], [b]) => a < b ? -1 : 1).slice(0, limit).map(([id, entry]) => ({ id, indexVersion: entry.version }))
    },
    async readVersion(id) { return orders.get(id)?.version },
    async readSource(id) {
      const entry = orders.get(id)
      return entry ? { ...structuredClone(entry.source), indexVersion: entry.version } : undefined
    },
    async markStale(id, remoteVersion) {
      const entry = orders.get(id)
      if (!entry || entry.indexed <= remoteVersion) return false
      entry.indexed = remoteVersion
      return true
    },
  }
  return store
}

/** Usa la primitiva condicional del SDK también en las regresiones del servicio, con fallos programables. */
function memoryIndex() {
  const remote = conditionalIndex(), records = remote.records, failures = []
  const writer = {
    saves: 0,
    beforeSave: undefined,
    fail(...errors) { failures.push(...errors) },
    async save(record) {
      if (writer.beforeSave) { const run = writer.beforeSave; writer.beforeSave = undefined; run() }
      if (failures.length) throw failures.shift()
      await remote.writer.save(record)
      writer.saves++
    },
    async readVersions(ids) { return remote.writer.readVersions(ids) },
    async readRecords(ids) { return remote.writer.readRecords(ids) },
  }
  return { records, writer }
}
const unavailable = () => Object.assign(new Error('PRIVATE'), { status: 503 })
const rejected = () => Object.assign(new Error('PRIVATE'), { status: 403 })

test('indexa una Order nueva, actualiza estados y nunca duplica registros', async () => {
  const store = memoryIndexStore(), { records, writer } = memoryIndex()
  store.add(b2c())
  const service = new OrderIndexSyncService(store, writer, quiet)
  assert.equal(await service.syncOrder('order-1'), 'synced')
  assert.equal(await service.syncOrder('order-1'), 'up-to-date')
  assert.equal(await service.syncOrder('missing'), 'not-found')
  for (const [orderStatus, paymentStatus] of [['PENDING', 'DECLINED'], ['PENDING', 'ERROR'], ['CONFIRMED', 'APPROVED']]) {
    store.bump('order-1', { orderStatus, paymentStatus })
    assert.equal(await service.syncOrder('order-1'), 'synced')
    assert.deepEqual([records.get('order-1').orderStatus, records.get('order-1').paymentStatus], [orderStatus, paymentStatus])
  }
  assert.equal(records.size, 1)
  assert.equal(records.get('order-1').indexVersion, 4)
  assert.equal(records.get('order-1').orderNumber, orderFixture('order-1').orderNumber)
  assert.equal(writer.saves, 4)
})

test('una revisión posterior durante la escritura se sincroniza y la anterior no queda como vigente', async () => {
  const store = memoryIndexStore(), { records, writer } = memoryIndex()
  store.add(b2c())
  writer.beforeSave = () => store.bump('order-1', { orderStatus: 'CONFIRMED', paymentStatus: 'APPROVED' })
  assert.equal(await new OrderIndexSyncService(store, writer, quiet).syncOrder('order-1'), 'synced')
  assert.equal(records.get('order-1').indexVersion, 2)
  assert.equal(records.get('order-1').paymentStatus, 'APPROVED')
  assert.equal(store.orders.get('order-1').indexed, 2)
  assert.deepEqual(await store.complete('order-1', 'stale-token', 1), { pending: true })
  assert.equal(store.orders.get('order-1').indexed, 2)
})

test('un lease activo excluye a otro proceso; uno vencido permite recuperar tras un reinicio', async () => {
  const store = memoryIndexStore(), { writer } = memoryIndex()
  store.add(b2c())
  const held = await store.claim('order-1', 60000)
  assert.equal(await new OrderIndexSyncService(store, writer, quiet).syncOrder('order-1'), 'busy')
  store.orders.get('order-1').lease.expires = Date.now() - 1
  assert.equal(await new OrderIndexSyncService(store, writer, quiet).syncOrder('order-1'), 'synced')
  assert.deepEqual(await store.complete('order-1', held.token, 1), { pending: true })
})

test('Retry idempotente ante fallos temporales; los rechazos no se reintentan y quedan pendientes', async () => {
  const store = memoryIndexStore(), { records, writer } = memoryIndex()
  const messages = []
  store.add(b2c())
  writer.fail(unavailable(), unavailable())
  const service = new OrderIndexSyncService(store, writer, { retryDelaysMs: [1, 1], log: message => messages.push(message) })
  assert.equal(await service.syncWithRetry('order-1'), 'synced')
  assert.equal(records.size, 1); assert.equal(writer.saves, 1)

  store.add(b2c({ order: orderFixture('order-3') }))
  writer.fail(rejected())
  assert.equal(await service.syncWithRetry('order-3'), 'failed')
  assert.equal(store.orders.get('order-3').failures, 1)
  assert.equal(store.orders.get('order-3').lastError, 'rejected')
  assert.equal(store.orders.get('order-3').indexed, 0)

  store.add(b2c({ order: orderFixture('order-4') }))
  writer.fail(unavailable(), unavailable(), unavailable())
  assert.equal(await service.syncWithRetry('order-4'), 'failed')
  assert.equal(store.orders.get('order-4').failures, 3)
  assert.deepEqual(messages, ['Sincronización de la Order order-3 con Algolia pendiente (rejected).',
    'Sincronización de la Order order-4 con Algolia pendiente (unavailable).'])
  assert.ok(messages.every(message => !message.includes('PRIVATE') && !message.includes('@')))
})

test('un registro inválido no se escribe y queda registrado para revisión', async () => {
  const store = memoryIndexStore(), { writer } = memoryIndex()
  store.add(b2c({ customerRole: 'ADMIN' }))
  await assert.rejects(new OrderIndexSyncService(store, writer, quiet).syncOrder('order-1'), { kind: 'invalid-record' })
  assert.equal(writer.saves, 0)
  assert.equal(store.orders.get('order-1').lastError, 'invalid-record')
})

test('Reconciliation: dry-run sin escrituras y recuperación con un servicio nuevo', async () => {
  const store = memoryIndexStore(), { records, writer } = memoryIndex()
  for (const id of ['order-a', 'order-b', 'order-c']) store.add(b2c({ order: orderFixture(id) }))
  store.add(b2c({ order: orderFixture('order-d'), customerRole: 'ADMIN' }))
  store.add(b2c({ order: orderFixture('order-e') }), 1)
  const dryRun = await new OrderIndexSyncService(store, writer, quiet).reconcile({ dryRun: true })
  assert.deepEqual(dryRun, { pending: 4, valid: 3, invalid: 1, synced: 0, failed: 0, skipped: 0 })
  assert.equal(records.size, 0)
  assert.ok([...store.orders.values()].every(entry => entry.lease === null))

  writer.fail(unavailable(), unavailable(), unavailable())
  const first = await new OrderIndexSyncService(store, writer, quiet).reconcile({ dryRun: false })
  assert.deepEqual(first, { pending: 4, valid: 3, invalid: 1, synced: 2, failed: 1, skipped: 0 })
  const restarted = await new OrderIndexSyncService(store, writer, quiet).reconcile({ dryRun: false })
  assert.deepEqual(restarted, { pending: 2, valid: 1, invalid: 1, synced: 1, failed: 0, skipped: 0 })
  assert.deepEqual([...records.keys()].sort(), ['order-a', 'order-b', 'order-c'])
  assert.deepEqual(await new OrderIndexSyncService(store, writer, quiet).reconcile({ dryRun: false, limit: 0 }),
    { pending: 0, valid: 0, invalid: 0, synced: 0, failed: 0, skipped: 0 })
})

test('verifyRemote detecta Orders ausentes u obsoletas en Algolia y las repara', async () => {
  const store = memoryIndexStore(), index = memoryIndex()
  for (const id of ['order-a', 'order-b', 'order-c']) store.add(b2c({ order: orderFixture(id), indexVersion: 2 }))
  const service = new OrderIndexSyncService(store, index.writer, quiet)
  await service.reconcile({ dryRun: false })
  index.records.delete('order-a')
  index.records.set('order-b', { ...index.records.get('order-b'), indexVersion: 1 })
  assert.deepEqual(await service.verifyRemote({ dryRun: true }), { checked: 3, drift: 2, repaired: 0, failed: 0 })
  assert.equal(index.records.has('order-a'), false)
  assert.deepEqual(await service.verifyRemote({ dryRun: false }), { checked: 3, drift: 2, repaired: 2, failed: 0 })
  assert.equal(index.records.get('order-a').indexVersion, 2)
  assert.equal(index.records.get('order-b').indexVersion, 2)
  assert.deepEqual(index.records.get('order-a'), toOrderIndexRecord(b2c({ order: orderFixture('order-a'), indexVersion: 2 })))
  assert.deepEqual(index.records.get('order-b'), toOrderIndexRecord(b2c({ order: orderFixture('order-b'), indexVersion: 2 })))
  assert.deepEqual(await service.verifyRemote({ dryRun: true }), { checked: 3, drift: 0, repaired: 0, failed: 0 })
})

test('verifyRemote relee PostgreSQL y reporta v999 como inconsistencia persistente sin modificar Orders ni Algolia', async () => {
  const store = memoryIndexStore(), remote = conditionalIndex(), messages = []
  const source = b2b({ indexVersion: 2 }), id = source.order.id
  store.add(source, 2)
  remote.records.set(id, { ...toOrderIndexRecord(source), indexVersion: 999, orderStatus: 'CONFIRMED', paymentStatus: 'APPROVED' })
  const beforeOrders = structuredClone([...store.orders]), beforeRemote = structuredClone([...remote.records])
  let reads = 0
  const readSource = store.readSource
  store.readSource = async requestedId => { assert.equal(requestedId, id); reads++; return readSource(requestedId) }
  const service = new OrderIndexSyncService(store, remote.writer, { ...quiet, log: message => messages.push(message) })
  for (const dryRun of [true, false, false]) {
    assert.deepEqual(await service.verifyRemote({ dryRun }), { checked: 1, drift: 1, repaired: 0, failed: 1 })
    assert.deepEqual([...store.orders], beforeOrders)
    assert.deepEqual([...remote.records], beforeRemote)
  }
  assert.equal(reads, 3)
  assert.equal(remote.calls.some(([kind]) => kind === 'partial'), false)
  assert.equal(messages.length, 3)
  assert.ok(messages.every(message => message.includes('999 superior a PostgreSQL 2') && message.includes('intervención controlada')))
  assert.ok(messages.every(message => !message.includes(source.order.buyer.email)))
})

test('verifyRemote reconoce v3 concurrente al releer PostgreSQL, sin confirmar indexedVersion por una lectura remota', async () => {
  const store = memoryIndexStore(), remote = conditionalIndex(), source = b2c({ indexVersion: 2 }), id = source.order.id
  store.add(source, 2)
  const readRecords = remote.writer.readRecords
  remote.writer.readRecords = async ids => {
    store.bump(id, { orderStatus: 'CONFIRMED', paymentStatus: 'APPROVED' })
    remote.records.set(id, toOrderIndexRecord({ ...source, indexVersion: 3, order: store.orders.get(id).source.order }))
    return readRecords(ids)
  }
  let reads = 0
  const readSource = store.readSource
  store.readSource = async requestedId => { reads++; return readSource(requestedId) }
  assert.deepEqual(await new OrderIndexSyncService(store, remote.writer, quiet).verifyRemote({ dryRun: false }),
    { checked: 1, drift: 0, repaired: 0, failed: 0 })
  assert.equal(reads, 1)
  assert.equal(store.orders.get(id).version, 3)
  assert.equal(store.orders.get(id).indexed, 2, 'La confirmación exige el protocolo de claim, contenido y token de F2-01.')
  assert.equal(remote.calls.some(([kind]) => kind === 'partial'), false)
})

test('verifyRemote usa la versión PostgreSQL reconsultada si avanzó más allá de la copia remota', async () => {
  const store = memoryIndexStore(), remote = conditionalIndex(), source = b2c({ indexVersion: 2 }), id = source.order.id
  store.add(source, 2)
  const readRecords = remote.writer.readRecords
  remote.writer.readRecords = async ids => {
    store.bump(id, { paymentStatus: 'DECLINED' })
    remote.records.set(id, toOrderIndexRecord({ ...source, indexVersion: 3, order: structuredClone(store.orders.get(id).source.order) }))
    store.bump(id, { orderStatus: 'CONFIRMED', paymentStatus: 'APPROVED' })
    return readRecords(ids)
  }
  assert.deepEqual(await new OrderIndexSyncService(store, remote.writer, quiet).verifyRemote({ dryRun: false }),
    { checked: 1, drift: 1, repaired: 1, failed: 0 })
  assert.equal(store.orders.get(id).indexed, 4)
  assert.deepEqual(remote.records.get(id), toOrderIndexRecord({ ...source, indexVersion: 4, order: store.orders.get(id).source.order }))
  assert.deepEqual(store.orders.get(id).source.order.totals, source.order.totals)
})

test('verifyRemote distingue una versión inválida de un registro ausente y la mantiene visible sin reparaciones ciegas', async () => {
  for (const indexVersion of [undefined, null, 0, -1, '2', 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    const store = memoryIndexStore(), remote = conditionalIndex(), source = b2c({ indexVersion: 2 }), id = source.order.id
    store.add(source, 2)
    const record = { ...toOrderIndexRecord(source), indexVersion }
    if (indexVersion === undefined) delete record.indexVersion
    remote.records.set(id, record)
    const beforeOrders = structuredClone([...store.orders]), beforeRemote = structuredClone([...remote.records]), messages = []
    const service = new OrderIndexSyncService(store, remote.writer, { ...quiet, log: message => messages.push(message) })
    assert.equal((await remote.writer.readVersions([id])).get(id), null)
    for (const dryRun of [true, false]) {
      assert.deepEqual(await service.verifyRemote({ dryRun }), { checked: 1, drift: 1, repaired: 0, failed: 1 })
      assert.deepEqual([...store.orders], beforeOrders)
      assert.deepEqual([...remote.records], beforeRemote)
    }
    assert.ok(messages.every(message => message.includes('versión remota inválida')))
    assert.equal(remote.calls.some(([kind]) => kind === 'partial'), false)
  }
})

test('verifyRemote no interpreta respuestas inciertas o incompletas de Algolia como registros ausentes', async () => {
  for (const response of [undefined, { results: [] }, { results: [undefined] }, { results: Array(1) }]) {
    const store = memoryIndexStore(), remote = conditionalIndex(), source = b2c({ indexVersion: 2 }), id = source.order.id
    store.add(source, 2)
    const beforeOrders = structuredClone([...store.orders])
    remote.client.getObjects = async () => { if (response === undefined) throw new Error('PRIVATE upstream credentials'); return response }
    await assert.rejects(new OrderIndexSyncService(store, remote.writer, quiet).verifyRemote({ dryRun: false }), error => {
      assert.equal(error.kind, 'unavailable')
      assert.ok(!error.message.includes('PRIVATE'))
      return true
    })
    assert.deepEqual([...store.orders], beforeOrders)
    assert.equal(remote.calls.some(([kind]) => kind === 'partial'), false)
  }
})

test('verifyRemote no declara saludable una revisión superior cuando falla su relectura autoritativa', async () => {
  for (const readSource of [async () => undefined, async () => { throw new OrderIndexError('persistence') }]) {
    const store = memoryIndexStore(), remote = conditionalIndex(), source = b2c({ indexVersion: 2 }), id = source.order.id
    store.add(source, 2)
    remote.records.set(id, { ...toOrderIndexRecord(source), indexVersion: 999 })
    store.readSource = readSource
    const beforeOrders = structuredClone([...store.orders]), beforeRemote = structuredClone([...remote.records])
    await assert.rejects(new OrderIndexSyncService(store, remote.writer, quiet).verifyRemote({ dryRun: false }), { kind: 'persistence' })
    assert.deepEqual([...store.orders], beforeOrders)
    assert.deepEqual([...remote.records], beforeRemote)
  }
})

test('verifyRemote conserva el fallo inconsistente mientras repara otras Orders mediante IncrementSet', async () => {
  const store = memoryIndexStore(), remote = conditionalIndex()
  const inconsistent = b2c({ order: orderFixture('order-a'), indexVersion: 2 })
  const missing = b2c({ order: orderFixture('order-b'), indexVersion: 2 })
  store.add(inconsistent, 2); store.add(missing, 2)
  const corrupt = { ...toOrderIndexRecord(inconsistent), indexVersion: 999 }
  remote.records.set(inconsistent.order.id, corrupt)
  const service = new OrderIndexSyncService(store, remote.writer, quiet)
  assert.deepEqual(await service.verifyRemote({ dryRun: false }), { checked: 2, drift: 2, repaired: 1, failed: 1 })
  assert.deepEqual(remote.records.get(inconsistent.order.id), corrupt)
  assert.deepEqual(remote.records.get(missing.order.id), toOrderIndexRecord(missing))
  assert.deepEqual(await service.verifyRemote({ dryRun: false }), { checked: 2, drift: 1, repaired: 0, failed: 1 })
})

test('readVersion PostgreSQL usa solo SELECT parametrizado y valida su resultado sin actualizar datos', async () => {
  const statements = []
  let rows = [{ index_version: 3 }]
  const store = new PostgreSQLOrderIndexStore({ transaction: async run => run({ query: async statement => { statements.push(statement); return { rows } } }) })
  const id = 'order-read-only'
  assert.equal(await store.readVersion(id), 3)
  assert.deepEqual(statements[0], { text: 'SELECT index_version FROM commerce.orders WHERE id = $1', values: [id], query_timeout: 2000 })
  rows = []
  assert.equal(await store.readVersion(id), undefined)
  for (const index_version of [0, -1, '3', 1.5]) {
    rows = [{ index_version }]
    await assert.rejects(store.readVersion(id), { kind: 'persistence' })
  }
  assert.ok(statements.every(({ text }) => text.startsWith('SELECT ')))
})

test('verifyRemote compara la proyección completa V1/V2 e ignora metadatos ajenos al DTO', async () => {
  for (const source of [b2c({ indexVersion: 2 }), b2b({ indexVersion: 2 })]) {
    const store = memoryIndexStore(), remote = conditionalIndex(), id = source.order.id
    store.add(source, 2)
    const record = { ...toOrderIndexRecord(source), _highlightResult: { ignored: true } }
    if (record.company) record.company = { ...record.company, _rankingInfo: { ignored: true } }
    remote.records.set(id, record)
    const beforeOrders = structuredClone([...store.orders]), beforeRemote = structuredClone([...remote.records])
    const service = new OrderIndexSyncService(store, remote.writer, quiet)
    for (const dryRun of [true, false]) {
      assert.deepEqual(await service.verifyRemote({ dryRun }), { checked: 1, drift: 0, repaired: 0, failed: 0 })
      assert.deepEqual([...store.orders], beforeOrders)
      assert.deepEqual([...remote.records], beforeRemote)
    }
    await remote.writer.save(toOrderIndexRecord(source))
    assert.deepEqual([...remote.records], beforeRemote, 'save comparte las reglas e ignora los mismos metadatos.')
  }
})

test('verifyRemote detecta atributos distintos, ausentes o de tipo incorrecto con la misma revisión sin reparaciones inseguras', async () => {
  const source = b2b({ indexVersion: 2 }), expected = toOrderIndexRecord(source), id = source.order.id
  const cases = [
    { ...expected, orderStatus: 'CONFIRMED' }, { ...expected, paymentStatus: 'DECLINED' },
    { ...expected, total: expected.total + 0.001 }, { ...expected, total: String(expected.total) },
    { ...expected, currency: 'USD' }, { ...expected, createdAt: 'invalid' },
    { ...expected, company: { id: expected.company.id } }, { ...expected, company: { name: expected.company.name } },
    { ...expected, company: null }, { ...expected, company: [] }, { ...expected, company: 'company' },
    { objectID: id, indexVersion: 2 },
  ]
  for (const field of Object.keys(expected)) {
    if (field === 'indexVersion') continue // Las revisiones inválidas se cubren en F2-02.
    const missing = { ...expected }; delete missing[field]; cases.push(missing)
  }
  for (const record of cases) {
    const store = memoryIndexStore(), remote = conditionalIndex(), messages = []
    store.add(source, 2); remote.records.set(id, record)
    const beforeOrders = structuredClone([...store.orders]), beforeRemote = structuredClone([...remote.records])
    const service = new OrderIndexSyncService(store, remote.writer, { ...quiet, log: message => messages.push(message) })
    for (const dryRun of [true, false, false]) {
      assert.deepEqual(await service.verifyRemote({ dryRun }), { checked: 1, drift: 1, repaired: 0, failed: 1 })
      assert.deepEqual([...store.orders], beforeOrders)
      assert.deepEqual([...remote.records], beforeRemote, 'Se conserva el contenido final, sin SaveObject ni Delete + Recreate.')
    }
    assert.equal(remote.calls.some(([kind]) => kind === 'partial'), false)
    assert.ok(messages.every(message => message.includes('contenido remoto incompatible') && !message.includes(source.order.buyer.email)))
  }
})

test('verifyRemote distingue Company opcional de null y branchId V1 obligatorio de ausencia', async () => {
  const source = b2c({ indexVersion: 2 }), id = source.order.id, expected = toOrderIndexRecord(source)
  for (const record of [{ ...expected, company: null }, { ...expected, company: {} },
    Object.fromEntries(Object.entries(expected).filter(([key]) => key !== 'branchId'))]) {
    const store = memoryIndexStore(), remote = conditionalIndex()
    store.add(source, 2); remote.records.set(id, record)
    const before = structuredClone(record)
    assert.deepEqual(await new OrderIndexSyncService(store, remote.writer, quiet).verifyRemote({ dryRun: false }),
      { checked: 1, drift: 1, repaired: 0, failed: 1 })
    assert.deepEqual(remote.records.get(id), before)
    assert.equal(store.orders.get(id).indexed, 2)
  }
})

test('verifyRemote contrasta el snapshot vigente si PostgreSQL avanza durante la lectura completa', async () => {
  const source = b2c({ indexVersion: 2 }), store = memoryIndexStore(), remote = conditionalIndex(), id = source.order.id
  store.add(source, 2)
  const older = { ...toOrderIndexRecord(source), paymentStatus: 'DECLINED' }
  remote.records.set(id, older)
  const readSource = store.readSource
  store.readSource = async requestedId => {
    store.bump(id, { orderStatus: 'CONFIRMED', paymentStatus: 'APPROVED' })
    return readSource(requestedId)
  }
  assert.deepEqual(await new OrderIndexSyncService(store, remote.writer, quiet).verifyRemote({ dryRun: true }),
    { checked: 1, drift: 1, repaired: 0, failed: 0 }, 'La copia v2 es anterior a PostgreSQL v3, no un conflicto de contenido v3.')
  assert.equal(store.orders.get(id).version, 3)
  assert.equal(store.orders.get(id).indexed, 2)
  assert.deepEqual(remote.records.get(id), older)
})

test('readSource PostgreSQL recupera el snapshot autoritativo mediante SELECT y rechaza datos inválidos', async () => {
  const order = orderFixture('00000000-0000-4000-8000-000000000001'), statements = []
  let rows = [{ ...orderToRow(order, owner), index_version: 2 }]
  const store = new PostgreSQLOrderIndexStore({ transaction: async run => run({ query: async statement => { statements.push(statement); return { rows } } }) })
  const source = await store.readSource(order.id)
  assert.deepEqual(toOrderIndexRecord(source), toOrderIndexRecord(b2c({ order, indexVersion: 2 })))
  assert.deepEqual(statements[0], { text: 'SELECT * FROM commerce.orders WHERE id = $1', values: [order.id], query_timeout: 2000 })
  rows = []
  assert.equal(await store.readSource(order.id), undefined)
  rows = [{ ...orderToRow(order, owner), index_version: 2, owner_user_id: 'other-owner' }]
  await assert.rejects(store.readSource(order.id), { kind: 'invalid-record' })
  assert.ok(statements.every(({ text }) => text.startsWith('SELECT ')))
})

test('CLI devuelve exit code 1 para el conflicto de contenido detectado por verifyRemote en ambos modos', async () => {
  for (const write of [false, true]) {
    const source = b2b({ indexVersion: 2 }), store = memoryIndexStore(), remote = conditionalIndex(), id = source.order.id, messages = []
    store.add(source, 2)
    const incomplete = { ...toOrderIndexRecord(source), company: { id: source.company.id }, paymentStatus: 'DECLINED' }
    remote.records.set(id, incomplete)
    const service = new OrderIndexSyncService(store, remote.writer, { ...quiet, log: message => messages.push(message) })
    const report = await service.verifyRemote({ dryRun: !write })
    assert.deepEqual(report, { checked: 1, drift: 1, repaired: 0, failed: 1 })
    const args = write ? ['--verify-remote', '--write', '--confirm-index=orders-test'] : ['--verify-remote']
    const result = runReportedCli(args, { report, log: messages[0] })
    assert.equal(result.status, 1)
    assert.match(result.stdout, /reparadas: 0; fallidas: 1/)
    assert.match(result.stderr, /contenido remoto incompatible/)
    assert.deepEqual(remote.records.get(id), incomplete)
    assert.equal(store.orders.get(id).indexed, 2)
  }
})

test('notify nunca bloquea ni propaga fallos y el notifier global queda inactivo sin PostgreSQL', async () => {
  const store = memoryIndexStore(), { records, writer } = memoryIndex()
  store.add(b2c())
  writer.fail(unavailable(), unavailable(), unavailable())
  const service = new OrderIndexSyncService(store, writer, quiet)
  assert.equal(service.notify('order-1'), undefined)
  await service.idle()
  assert.equal(records.size, 0)
  service.notify('order-1')
  await service.idle()
  assert.equal(records.size, 1)
  const failingStore = { ...store, claim: async () => { throw new OrderIndexError('persistence') } }
  const failing = new OrderIndexSyncService(failingStore, writer, quiet)
  failing.notify('order-1')
  await failing.idle()
  assert.doesNotThrow(() => orderIndexNotifier.notify('order-1'))
})

const product = { objectID: 'p', title: 'Producto', image_url: '', price: 10000, in_stock: true, stock_quantity: 5 }
const purchase = key => ({ termsAcceptance: { accepted: true, version: CURRENT_TERMS_VERSION },
  buyer: { fullName: 'Cliente', email: 'cliente@example.com', phone: '88888888' },
  delivery: { province: 'San José', canton: 'Central', address: 'Ficticia' }, items: [{ productId: 'p', quantity: 1 }], idempotencyKey: key })

test('OrderService y PaymentService notifican después de persistir, nunca ante fallos', async () => {
  const notified = []
  const notifier = { notify: id => notified.push(id) }
  const store = new InMemoryOrderStore()
  const orders = new OrderService(store, async () => product, notifier)
  const order = await orders.create(purchase('cn65-create'), owner)
  assert.deepEqual(notified, [order.id])
  await orders.create(purchase('cn65-create'), owner)
  assert.deepEqual(notified, [order.id, order.id])
  await assert.rejects(new OrderService(store, async () => undefined, notifier).create(purchase('cn65-missing'), owner), { code: 'PRODUCT_NOT_FOUND' })
  assert.equal(notified.length, 2)

  const payments = new PaymentService(store, { process: async input => ({ result: input.scenario }) }, undefined, notifier)
  const declined = await payments.process(order.id, paymentRequest('PAYMENT_DECLINED', 'cn65-declined'), owner.id)
  assert.equal(declined.order.paymentStatus, 'DECLINED')
  assert.deepEqual(notified.slice(2), [order.id])
  await assert.rejects(payments.process('missing', paymentRequest('PAYMENT_APPROVED', 'cn65-missing'), owner.id), { code: 'ORDER_NOT_FOUND' })
  assert.equal(notified.length, 3)
  const approved = await payments.process(order.id, paymentRequest('PAYMENT_APPROVED', 'cn65-approved'), owner.id)
  assert.equal(approved.order.orderStatus, 'CONFIRMED')
  assert.equal(notified.length, 4)
})

/** Solo permite módulos públicos y fixtures temporales; no hereda secretos, NODE_OPTIONS ni rutas dotenv. */
function runIsolatedCli(args, env = {}, { manualDefault = false, missingFile = false, relativePath = false, nodeCode } = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'cn65-orders-cli-'))
  try {
    const fixture = join(directory, missingFile ? '.env.absent' : '.env.testing')
    if (!missingFile) writeFileSync(fixture, 'ALGOLIA_ORDERS_INDEX_NAME=orders-from-file\n', 'utf8')
    const guardUrl = new URL('./helpers/orderIndexCliIsolation.mjs', import.meta.url)
    const guard = fileURLToPath(guardUrl)
    const environment = { PATH: process.env.PATH, SYSTEMROOT: process.env.SYSTEMROOT,
      DOTENV_CONFIG_PATH: manualDefault ? undefined : relativePath ? basename(fixture) : fixture, DOTENV_CONFIG_QUIET: 'true',
      CN65_CLI_EXPECTED_DOTENV: manualDefault ? fileURLToPath(new URL('../.env', import.meta.url)) : fixture,
      CN65_CLI_FIXTURE_DOTENV: fixture, COMMERCE_STORE_MODE: 'memory', DATABASE_URL: '',
      ALGOLIA_APP_ID: 'fake-app', ALGOLIA_API_KEY: 'fake-search', ALGOLIA_INDEX_NAME: 'products',
      ALGOLIA_USERS_INDEX_NAME: 'users', ALGOLIA_ORDERS_INDEX_NAME: 'orders-test',
      ALGOLIA_ORDERS_API_KEY: 'fake-orders-key', ALGOLIA_ORDERS_SETTINGS_API_KEY: '', ...env }
    const allowed = [directory, guard, ...['../dist/', '../node_modules/', '../package.json'].map(path => fileURLToPath(new URL(path, import.meta.url)))]
    const entry = nodeCode === undefined ? [fileURLToPath(new URL('../dist/scripts/syncOrdersIndex.js', import.meta.url)), ...args]
      : ['--input-type=module', '--eval', nodeCode]
    const result = spawnSync(process.execPath, ['--permission', ...allowed.map(path => `--allow-fs-read=${path}`), '--import', guardUrl.href, ...entry], {
      cwd: directory, encoding: 'utf8', timeout: 10000,
      env: Object.fromEntries(Object.entries(environment).filter(([, value]) => value !== undefined)),
    })
    assert.equal(result.error, undefined, result.error?.code)
    const report = result.stderr.match(/^CN65_CLI_AUDIT (\{.*\})$/m)
    assert.ok(report, 'El preload de aislamiento debe ejecutarse antes del CLI.')
    return { ...result, audit: JSON.parse(report[1]) }
  } finally {
    const target = resolve(directory)
    assert.ok(target.startsWith(resolve(tmpdir()) + sep) && basename(target).startsWith('cn65-orders-cli-'))
    rmSync(target, { recursive: true, force: true })
  }
}
function runScript(...parameters) {
  const result = runIsolatedCli(...parameters)
  assert.equal(result.audit.unexpectedEnvironmentReads, 0, 'El CLI no debe intentar leer otra configuración.')
  assert.equal(result.audit.networkAttempts, 0, 'El CLI no debe intentar abrir conexiones.')
  return result
}

test('el script exige confirmación exacta y nunca escribe en dry-run', () => {
  const settings = runScript(['--configure-settings'])
  assert.equal(settings.status, 0, settings.stderr)
  assert.match(settings.stdout, /attributesForFaceting/)
  assert.match(settings.stdout, /DRY RUN; Algolia requests = 0/)
  assert.equal(settings.audit.environmentReads, 0)

  for (const [args, env, message] of [
    [['--unknown'], {}, /Argumento desconocido/],
    [['--write', '--write'], {}, /repetido/],
    [['--confirm-index=orders-test'], {}, /--confirm-index requiere --write/],
    [['--write'], {}, /--write requiere --confirm-index/],
    [['--limit=0'], {}, /--limit/],
    [['--verify-remote', '--configure-settings'], {}, /no se combina/],
    [['--write', '--confirm-index=products'], {}, /no coincide/],
    [['--write', '--confirm-index=products'], { ALGOLIA_ORDERS_INDEX_NAME: 'products' }, /inválida o incompleta/],
    [['--write', '--confirm-index=users'], { ALGOLIA_ORDERS_INDEX_NAME: 'users' }, /inválida o incompleta/],
    [['--configure-settings', '--write', '--confirm-index=orders-test'], {}, /ALGOLIA_ORDERS_SETTINGS_API_KEY/],
    [[], {}, /PostgreSQL no está disponible/],
  ]) {
    const result = runScript(args, env)
    assert.equal(result.status, 1, args.join(' ') + result.stdout)
    assert.match(result.stderr, message)
    assert.ok(!result.stdout.includes('Mode: WRITE'))
    assert.ok(!(result.stdout + result.stderr).includes('fake-orders-key'))
  }
})

test('argumentos inválidos del CLI fallan antes de cargar dotenv, incluso sin archivo de configuración', () => {
  for (const args of [['--unknown'], ['--write'], ['--limit=0'], ['--write', '--write']]) {
    const result = runScript(args, {}, { missingFile: true })
    assert.equal(result.status, 1)
    assert.equal(result.audit.environmentReads, 0)
  }
})

test('el CLI y dotenv/config comparten la ruta de Testing desde un cwd aislado', () => {
  for (const relativePath of [false, true]) {
    const result = runScript(['--write', '--confirm-index=wrong-index'], { ALGOLIA_ORDERS_INDEX_NAME: undefined }, { relativePath })
    assert.equal(result.status, 1)
    assert.match(result.stderr, /no coincide exactamente/)
    assert.ok(result.audit.environmentReads > 0, 'El nombre del índice procede únicamente del fixture.')
    assert.ok(!result.stderr.includes('fake-orders-key'))
  }
})

test('el CLI conserva el default manual server/.env con una lectura simulada y tolera su ausencia', () => {
  const configured = runScript(['--write', '--confirm-index=wrong-index'], { ALGOLIA_ORDERS_INDEX_NAME: undefined }, { manualDefault: true })
  assert.equal(configured.status, 1)
  assert.match(configured.stderr, /no coincide exactamente/)
  assert.ok(configured.audit.environmentReads > 0)
  for (const manualDefault of [false, true]) {
    const absent = runScript([], {}, { manualDefault, missingFile: true })
    assert.equal(absent.status, 1)
    assert.match(absent.stderr, /PostgreSQL no está disponible/)
    assert.ok(absent.audit.environmentReads > 0)
  }
})

test('el aislamiento del CLI deniega el archivo privado y bloquea sockets antes de una conexión', () => {
  const privatePath = fileURLToPath(new URL('../.env', import.meta.url))
  const permissions = runScript([], {}, { nodeCode: `console.log(process.permission.has('fs.read', ${JSON.stringify(privatePath)}))` })
  assert.equal(permissions.status, 0)
  assert.equal(permissions.stdout.trim(), 'false', 'Se consulta el permiso, nunca el archivo privado.')
  const unexpected = runIsolatedCli([], {}, { nodeCode: "import fs from 'node:fs'; try { fs.readFileSync('.env.unexpected') } catch {}" })
  assert.equal(unexpected.status, 1)
  assert.equal(unexpected.audit.unexpectedEnvironmentReads, 1)
  const blocked = runIsolatedCli([], {}, { nodeCode: "import net from 'node:net'; try { net.connect({ host: 'example.invalid', port: 5432 }) } catch {}" })
  assert.equal(blocked.status, 1)
  assert.equal(blocked.audit.networkAttempts, 1)
  assert.equal(blocked.audit.unexpectedEnvironmentReads, 0)
})

/** Dobles exclusivos de este CLI para comprobar el exit code real y esperar close(), sin servicios externos. */
function runReportedCli(args, scenario) {
  const script = new URL('../dist/scripts/syncOrdersIndex.js', import.meta.url).href
  const modules = [
    [new URL('../dist/db/pool.js', import.meta.url).href, `
      export class Database {
        async close() {
          await new Promise(resolve => setTimeout(resolve, 10));
          console.error('CN65_CLI_CLOSED');
        }
      }`],
    [new URL('../dist/stores/postgreSQLOrderIndexStore.js', import.meta.url).href,
      'export class PostgreSQLOrderIndexStore {}'],
    [new URL('../dist/services/orderIndexSyncService.js', import.meta.url).href, `
      const scenario = ${JSON.stringify(scenario)};
      export function createAlgoliaOrderIndexWriter() { return {}; }
      export class OrderIndexSyncService {
        constructor(store, writer, options) { this.log = options.log; }
        async verifyRemote() { return this.result('verifyRemote'); }
        async reconcile() { return this.result('reconcile'); }
        result(operation) {
          console.error('CN65_CLI_OPERATION ' + operation);
          if (scenario.log) this.log(scenario.log);
          if (scenario.exception) throw new Error('PRIVATE_UPSTREAM fake-orders-key');
          return scenario.report;
        }
      }`],
  ]
  const nodeCode = `
    import { registerHooks } from 'node:module';
    const modules = new Map(${JSON.stringify(modules)});
    registerHooks({ load(url, context, nextLoad) {
      if (modules.has(url)) return { format: 'module', source: modules.get(url), shortCircuit: true };
      return nextLoad(url, context);
    } });
    process.argv = [process.execPath, ${JSON.stringify(script)}, ...${JSON.stringify(args)}];
    await import(${JSON.stringify(script)});
  `
  const result = runScript(args, {}, { nodeCode })
  assert.equal((result.stderr.match(/CN65_CLI_CLOSED/g) ?? []).length, 1, 'El cierre asíncrono debe completarse antes de terminar.')
  assert.equal((result.stderr.match(/CN65_CLI_OPERATION /g) ?? []).length, 1, 'El CLI no añade reintentos.')
  assert.ok(!(result.stdout + result.stderr).includes('fake-orders-key'))
  return result
}

test('CLI verifyRemote exitoso mantiene exit code 0 en Dry-Run, incluso con drift reparable', () => {
  for (const drift of [0, 1]) {
    const result = runReportedCli(['--verify-remote'], { report: { checked: 2, drift, repaired: 0, failed: 0 } })
    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, /Mode: DRY RUN; Algolia writes = 0; PostgreSQL writes = 0/)
    assert.match(result.stdout, /fallidas: 0/)
  }
})

test('CLI verifyRemote termina con exit code 1 ante fallos totales o reparaciones parciales', () => {
  for (const repaired of [0, 2]) {
    const result = runReportedCli(['--verify-remote', '--write', '--confirm-index=orders-test'],
      { report: { checked: 3, drift: 3, repaired, failed: 1 } })
    assert.equal(result.status, 1)
    assert.ok(result.stdout.includes(`reparadas: ${repaired}; fallidas: 1`))
    assert.match(result.stdout, /Mode: WRITE/)
  }
})

test('CLI verifyRemote mantiene exit code 0 cuando todas las reparaciones terminaron', () => {
  const result = runReportedCli(['--verify-remote', '--write', '--confirm-index=orders-test'],
    { report: { checked: 2, drift: 2, repaired: 2, failed: 0 } })
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /reparadas: 2; fallidas: 0/)
})

test('CLI no comunica éxito para una revisión superior inconsistente detectada en Dry-Run', () => {
  const result = runReportedCli(['--verify-remote'], { report: { checked: 1, drift: 1, repaired: 0, failed: 1 },
    log: 'Inconsistencia del índice orders para la Order order-1: versión remota 999 superior a PostgreSQL 2; requiere intervención controlada.' })
  assert.equal(result.status, 1)
  assert.match(result.stdout, /reparadas: 0; fallidas: 1/)
  assert.match(result.stderr, /999 superior a PostgreSQL 2/)
  assert.match(result.stderr, /requiere intervención controlada/)
})

test('CLI conserva exit code 1, sanitización y cleanup ante excepciones en ambas rutas', () => {
  for (const args of [[], ['--verify-remote']]) {
    const result = runReportedCli(args, { exception: true })
    assert.equal(result.status, 1)
    assert.match(result.stderr, /Error inesperado de la sincronización; detalles omitidos por seguridad/)
    assert.ok(!result.stderr.includes('PRIVATE_UPSTREAM'))
    assert.ok(!result.stdout.includes('Mode: WRITE'))
  }
})

test('CLI Reconciliation normal conserva sus exit codes para éxito, fallos y registros inválidos', () => {
  for (const [failed, invalid, status] of [[0, 0, 0], [1, 0, 1], [0, 1, 1]]) {
    const result = runReportedCli([], { report: { pending: 1, valid: invalid ? 0 : 1, invalid, synced: 0, failed, skipped: 0 } })
    assert.equal(result.status, status)
    assert.ok(result.stdout.includes(`fallidas: ${failed}`))
    assert.ok(result.stdout.includes(`inválidas: ${invalid}`))
    assert.match(result.stdout, /Mode: DRY RUN; Algolia requests = 0; PostgreSQL writes = 0/)
  }
})
