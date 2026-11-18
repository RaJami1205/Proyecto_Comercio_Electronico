/** CN-65: mapper, filtros, configuración, sincronización, Retry y Reconciliation con dobles, sin PostgreSQL ni Algolia reales. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
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
  const writer = createAlgoliaOrderIndexWriter(() => ({
    addOrUpdateObject: async request => { calls.push(['save', request]); return { taskID: 7 } },
    waitForTask: async request => { calls.push(['wait', request]) },
    getObjects: async request => { calls.push(['get', request]); return { results: request.requests.map((item, position) => position === 0 ? { indexVersion: 3 } : position === 1 ? null : { indexVersion: 'x' }) } },
  }), () => 'orders-test')
  const record = toOrderIndexRecord(b2c())
  await writer.save(record)
  assert.deepEqual(calls[0], ['save', { indexName: 'orders-test', objectID: 'order-1', body: record }])
  assert.deepEqual(calls[1], ['wait', { indexName: 'orders-test', taskID: 7, maxRetries: 20 }])
  const versions = await writer.readVersions(Array.from({ length: 1001 }, (_, index) => 'order-' + index))
  assert.equal(calls.filter(([kind]) => kind === 'get').length, 2)
  assert.ok(calls[2][1].requests.every(request => request.indexName === 'orders-test' && request.attributesToRetrieve[0] === 'indexVersion'))
  assert.deepEqual([versions.get('order-0'), versions.has('order-1'), versions.has('order-2'), versions.get('order-1000')], [3, false, false, 3])
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
    async markStale(id, remoteVersion) {
      const entry = orders.get(id)
      if (!entry || entry.indexed <= remoteVersion) return false
      entry.indexed = remoteVersion
      return true
    },
  }
  return store
}

/** Índice en memoria con reemplazo por objectID y fallos programables. */
function memoryIndex() {
  const records = new Map(), failures = []
  const writer = {
    saves: 0,
    beforeSave: undefined,
    fail(...errors) { failures.push(...errors) },
    async save(record) {
      if (writer.beforeSave) { const run = writer.beforeSave; writer.beforeSave = undefined; run() }
      if (failures.length) throw failures.shift()
      writer.saves++
      records.set(record.objectID, structuredClone(record))
    },
    async readVersions(ids) { return new Map(ids.filter(id => records.has(id)).map(id => [id, records.get(id).indexVersion])) },
  }
  return { records, writer }
}
const unavailable = () => Object.assign(new Error('PRIVATE'), { status: 503 })
const rejected = () => Object.assign(new Error('PRIVATE'), { status: 403 })
const quiet = { retryDelaysMs: [1, 1], log() {} }

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
  for (const id of ['order-a', 'order-b', 'order-c']) store.add(b2c({ order: orderFixture(id) }))
  const service = new OrderIndexSyncService(store, index.writer, quiet)
  await service.reconcile({ dryRun: false })
  index.records.delete('order-a')
  index.records.set('order-b', { ...index.records.get('order-b'), indexVersion: 0 })
  assert.deepEqual(await service.verifyRemote({ dryRun: true }), { checked: 3, drift: 2, repaired: 0, failed: 0 })
  assert.equal(index.records.has('order-a'), false)
  assert.deepEqual(await service.verifyRemote({ dryRun: false }), { checked: 3, drift: 2, repaired: 2, failed: 0 })
  assert.equal(index.records.get('order-a').indexVersion, 1)
  assert.equal(index.records.get('order-b').indexVersion, 1)
  assert.deepEqual(await service.verifyRemote({ dryRun: true }), { checked: 3, drift: 0, repaired: 0, failed: 0 })
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

/** Ejecuta el script compilado sin PostgreSQL ni credenciales reales; las guardas abortan antes de cualquier IO. */
const runScript = (args, env = {}) => spawnSync(process.execPath, [fileURLToPath(new URL('../dist/scripts/syncOrdersIndex.js', import.meta.url)), ...args], {
  encoding: 'utf8',
  env: { PATH: process.env.PATH, SYSTEMROOT: process.env.SYSTEMROOT, DATABASE_URL: '', ALGOLIA_APP_ID: 'fake-app', ALGOLIA_API_KEY: 'fake-search',
    ALGOLIA_INDEX_NAME: 'products', ALGOLIA_USERS_INDEX_NAME: 'users', ALGOLIA_ORDERS_INDEX_NAME: 'orders-test',
    ALGOLIA_ORDERS_API_KEY: 'fake-orders-key', ALGOLIA_ORDERS_SETTINGS_API_KEY: '', ...env },
})

test('el script exige confirmación exacta y nunca escribe en dry-run', () => {
  const settings = runScript(['--configure-settings'])
  assert.equal(settings.status, 0, settings.stderr)
  assert.match(settings.stdout, /attributesForFaceting/)
  assert.match(settings.stdout, /DRY RUN; Algolia requests = 0/)

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
