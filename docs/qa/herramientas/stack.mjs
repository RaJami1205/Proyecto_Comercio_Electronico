/** Browser QA: Express real + Stores In-Memory + Algolia ficticio. Sin PostgreSQL ni evidencias. */
import http from 'node:http'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, extname, join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { API, BASE, CLIENT, ROOT, installStackIsolation, staticFile } from './isolation.mjs'

const audit = installStackIsolation()
const requireClient = createRequire(join(ROOT, 'client/package.json'))
const requireServer = createRequire(join(ROOT, 'server/package.json'))
const { Pool } = requireServer('pg')
for (const method of ['connect', 'query']) Pool.prototype[method] = () => { audit.postgres = (audit.postgres ?? 0) + 1; throw new Error('CN69_BROWSER_POSTGRES_BLOCKED') }
const { build } = await import(pathToFileURL(requireClient.resolve('vite')).href)
const { default: react } = await import(pathToFileURL(requireClient.resolve('@vitejs/plugin-react')).href)
const temporary = await mkdtemp(join(tmpdir(), 'cn69-browser-build-'))
let api, web, stopping
async function stop() {
  stopping ??= (async () => {
    await Promise.all([api, web].filter(Boolean).map(server => new Promise(done => { server.close(done); server.closeAllConnections() })))
    if (dirname(temporary) !== resolve(tmpdir()) || !basename(temporary).startsWith('cn69-browser-build-')) throw new Error('CN69_BROWSER_CLEANUP_TARGET')
    await rm(temporary, { recursive: true, force: true })
    if (process.connected) { process.send({ type: 'qa-stopped' }); process.disconnect() }
  })()
  return stopping
}
process.once('SIGINT', () => { void stop() })
process.once('SIGTERM', () => { void stop() })
process.on('message', message => { if (message === 'qa-stop') void stop() })
process.once('disconnect', () => { void stop() })
try {
  await build({ root: join(ROOT, 'client'), configFile: false, envDir: false, base: BASE, plugins: [react()],
    define: { 'import.meta.env.VITE_API_BASE_URL': JSON.stringify(API) },
    build: { outDir: temporary, emptyOutDir: false }, logLevel: 'error' })
  const { QA_PRODUCTS, QA_USERS, createFakeAlgoliaCatalog } = await import(pathToFileURL(join(ROOT, 'server/tests/helpers/fakeAlgoliaCatalog.mjs')).href)
  const { getAlgoliaClient } = await import(pathToFileURL(join(ROOT, 'server/dist/config/algolia.js')).href)
  const { userService } = await import(pathToFileURL(join(ROOT, 'server/dist/services/userService.js')).href)
  const { commerceStores } = await import(pathToFileURL(join(ROOT, 'server/dist/stores/commerceStores.js')).href)
  if (commerceStores.orders.constructor.name !== 'InMemoryOrderStore' || commerceStores.payments.constructor.name !== 'InMemoryPaymentStore') throw new Error('CN69_BROWSER_UNSAFE_COMPOSITION')
  const products = QA_PRODUCTS.map((product, index) => ({ ...structuredClone(product), sku: index === 0 ? 'G.S-MEM-0118' : 'QA-SKU-' + index }))
  for (let index = 1; index <= 28; index++) products.push({ ...structuredClone(QA_PRODUCTS[0]), objectID: 'qa-extra-' + index,
    title: 'Accesorio QA ' + String(index).padStart(2, '0'), sku: 'QA-EXTRA-' + index, brand: 'QA', price: 1000 + index * 100,
    b2b: { available: true, wholesale_price: 800, min_order_quantity: 3 } })
  const catalog = createFakeAlgoliaCatalog(products)
  const client = getAlgoliaClient()
  for (const key of Object.keys(client)) if (typeof client[key] === 'function' && key !== 'searchSingleIndex' && key !== 'getObject') client[key] = () => { audit.algolia = (audit.algolia ?? 0) + 1; throw new Error('CN69_BROWSER_ALGOLIA_OPERATION_BLOCKED') }
  client.searchSingleIndex = catalog.searchSingleIndex
  client.getObject = catalog.getObject
  userService.directory.find = async id => QA_USERS.find(user => user.objectID === id)
  userService.directory.list = async () => QA_USERS
  const { adminOrderService } = await import(pathToFileURL(join(ROOT, 'server/dist/services/adminOrderService.js')).href)
  adminOrderService.search = { async search(q, filters, page, pageSize) {
    const { entries } = await commerceStores.orders.listAll(filters, 'newest', 0, 10000)
    const found = entries.filter(entry => JSON.stringify([entry.order.orderNumber, entry.owner]).toLowerCase().includes(q.toLowerCase()))
    return { hits: found.slice((page - 1) * pageSize, page * pageSize).map(entry => ({ id: entry.order.id,
      orderStatus: entry.order.orderStatus, paymentStatus: entry.order.paymentStatus })), total: found.length }
  } }
  const { default: app } = await import(pathToFileURL(join(ROOT, 'server/dist/app.js')).href)
  api = app.listen(3001, '127.0.0.1')
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.ico': 'image/x-icon' }
  web = http.createServer(async (request, response) => {
    const file = staticFile(temporary, request.url)
    try {
      if (!file) { response.writeHead(404); response.end(); return }
      const body = await readFile(file)
      response.writeHead(200, { 'Content-Type': types[extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' }); response.end(body)
    } catch { response.writeHead(404); response.end() }
  }).listen(4173, '127.0.0.1')
  await Promise.all([api, web].map(server => new Promise((done, reject) => { server.once('listening', done); server.once('error', reject) })))
  console.log('CN69_BROWSER_READY memory ' + CLIENT + BASE)
  if (process.connected) process.send({ type: 'qa-ready', url: CLIENT + BASE, storage: 'memory' })
} catch (error) {
  console.error('CN69_BROWSER_STACK_FAILED ' + error.message)
  process.exitCode = 1
  await stop()
}
