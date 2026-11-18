/**
 * CN-69 QA. Levanta el stack local para el E2E en navegador.
 * Server real con PostgreSQL aislado (misma base efímera que la CI), Algolia ficticio y el Client compilado.
 * Nunca usar con credenciales de producción. Ver README.md de esta carpeta.
 */
import http from 'node:http'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import os from 'node:os'
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const { QA_ALGOLIA_ENV, QA_USERS, createFakeAlgoliaCatalog } = await import(path.join(REPO, 'server/tests/helpers/fakeAlgoliaCatalog.mjs'))
Object.assign(process.env, QA_ALGOLIA_ENV, {
  CLIENT_ORIGIN: 'http://127.0.0.1:4173', COMMERCE_STORE_MODE: 'postgresql', ORDER_CREATION_MODE: 'v2-only',
  // Solo loopback. La aplicación rechaza sslmode disable fuera de localhost.
  DATABASE_URL: process.env.QA_DATABASE_URL ?? 'postgresql://cibernova_app:ci-runtime-ephemeral-only@127.0.0.1:5432/cibernova_test', DATABASE_SSL_MODE: 'disable',
})
const { getAlgoliaClient } = await import(path.join(REPO, 'server/dist/config/algolia.js'))
const { userService } = await import(path.join(REPO, 'server/dist/services/userService.js'))
const { default: app } = await import(path.join(REPO, 'server/dist/app.js'))
const catalog = createFakeAlgoliaCatalog()
const client = getAlgoliaClient()
client.searchSingleIndex = catalog.searchSingleIndex
client.getObject = catalog.getObject
userService.directory.find = async id => QA_USERS.find(user => user.objectID === id)
userService.directory.list = async () => QA_USERS
app.listen(3001, '127.0.0.1', () => console.log('API http://127.0.0.1:3001'))
// Sirve el build del Client bajo la misma base que GitHub Pages.
const dist = process.env.QA_CLIENT_DIST ?? path.join(os.tmpdir(), 'cibernova-qa-client'), base = '/Proyecto_Comercio_Electronico/'
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.ico': 'image/x-icon' }
http.createServer(async (request, response) => {
  const url = new URL(request.url, 'http://x')
  let file = url.pathname.startsWith(base) ? url.pathname.slice(base.length) : ''
  if (!file || file.endsWith('/')) file += 'index.html'
  try { const body = await readFile(path.join(dist, file)); response.writeHead(200, { 'Content-Type': types[path.extname(file)] ?? 'application/octet-stream' }); response.end(body) }
  catch { response.writeHead(404); response.end('not found') }
}).listen(4173, '127.0.0.1', () => console.log('Client http://127.0.0.1:4173' + base))
