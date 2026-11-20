/** CN-69 TEST-ONLY. Siempre aislamiento antes de pg, dotenv, servicios y Express. */
import './postgresIntegrationIsolation.mjs'
import { serverProcessOptions } from './postgresServerProcess.mjs'
import { guardIntegrationDatabase, verifyIntegrationDatabases } from './postgresIntegrationHarness.mjs'
import { QA_USERS, createFakeAlgoliaCatalog } from './fakeAlgoliaCatalog.mjs'

let db, server, stopping, startupDone = false, stopRequested = false
async function stop() {
  stopping ??= (async () => {
    try {
      if (server) await new Promise(resolve => { server.close(resolve); server.closeAllConnections() })
      await db?.close()
    } finally { if (process.connected) process.disconnect() }
  })()
  return stopping
}
const shutdown = () => {
  stopRequested = true
  if (startupDone) void stop().catch(() => { process.exitCode = 1 })
}
process.on('message', message => { if (message === 'cn69-server-stop') shutdown() })
process.once('disconnect', shutdown)
process.once('SIGTERM', shutdown)
process.once('SIGINT', shutdown)

try {
  const run = process.argv[2]
  serverProcessOptions(run, process.env)
  const [{ Database }, { getDatabaseTestConfig }] = await Promise.all([
    import('../../dist/db/pool.js'), import('../../dist/config/database.js')])
  const config = getDatabaseTestConfig({ ...process.env, DATABASE_TEST_URL: process.env.DATABASE_RUNTIME_TEST_URL })
  db = guardIntegrationDatabase(new Database(() => ({ ...config, max: 2 })), 'runtime')
  // No API/fixtures antes de la identidad real PG17 + DB + login + IP del contenedor + permisos mínimos.
  await verifyIntegrationDatabases(db)
  // Columnas de las cuatro migrations y acceso runtime comprobados sin escribir.
  await db.query('SELECT contract_version, pricing_type, commercial_policy_version, index_version FROM commerce.orders LIMIT 0')
  await db.query('SELECT canonical_version FROM commerce.order_creation_requests LIMIT 0')
  await db.query('SELECT scenario, result, order_snapshot FROM commerce.payment_attempts LIMIT 0')

  const [{ createCommerceStores }, { orderService }, { paymentService },
    { userService }, { getAlgoliaClient }] = await Promise.all([
    import('../../dist/stores/commerceStoreFactory.js'),
    import('../../dist/services/orderService.js'), import('../../dist/services/paymentService.js'),
    import('../../dist/services/userService.js'), import('../../dist/config/algolia.js')])
  const { orders, payments } = createCommerceStores('postgresql', db)
  if (!payments.isFor(orders)) throw new Error('CN69_POSTGRES_SERVER_COMPOSITION')
  orderService.store = orders
  paymentService.store = orders
  paymentService.persistence = payments
  const records = QA_USERS.map(user => ({ ...user, objectID: user.objectID + '-' + run }))
  userService.directory.find = async id => records.find(record => record.objectID === id)
  userService.directory.list = async () => records
  const catalog = createFakeAlgoliaCatalog()
  const algolia = getAlgoliaClient()
  for (const key of Object.keys(algolia)) if (typeof algolia[key] === 'function') {
    algolia[key] = () => { throw new Error('CN69_POSTGRES_ALGOLIA_BLOCKED') }
  }
  algolia.searchSingleIndex = catalog.searchSingleIndex
  algolia.getObject = catalog.getObject
  // Conserva el Sandbox real, contando ejecuciones sin exponer datos del pago.
  const processPayment = paymentService.sandbox.process.bind(paymentService.sandbox)
  let paymentsProcessed = 0
  paymentService.sandbox.process = async request => { paymentsProcessed++; return processPayment(request) }
  const { default: app } = await import('../../dist/app.js')
  server = app.listen(0, '127.0.0.1')
  await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject) })
  process.on('message', message => {
    if (message === 'cn69-server-counts' && process.connected) process.send({ type: 'cn69-server-counts',
      catalog: catalog.calls.length, payments: paymentsProcessed })
  })
  startupDone = true
  if (stopRequested || !process.connected) throw new Error('CN69_POSTGRES_SERVER_STOPPED_DURING_START')
  process.send({ type: 'cn69-server-ready', pid: process.pid, port: server.address().port,
    storage: 'postgresql', verified: true })
} catch {
  console.error('CN69_POSTGRES_SERVER_START_FAILED')
  process.exitCode = 1
  await stop().catch(() => { process.exitCode = 1 })
}
