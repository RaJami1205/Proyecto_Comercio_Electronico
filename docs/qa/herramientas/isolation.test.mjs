/** Guardas puras del Browser QA, sin arrancar servidores ni navegador. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { readFileSync } from 'node:fs'
import { API, BASE, CLIENT, assertLocalSocket, compilerMappingProbe, dotenvPath, localBrowserUrl, operatingEnvironment, stackEnvironment, staticFile } from './isolation.mjs'
test('descarta configuración heredada, credenciales y opciones Node', () => {
  const result = operatingEnvironment({ PATH: 'fake', DATABASE_URL: 'fake-secret', NODE_OPTIONS: 'fake', ALGOLIA_API_KEY: 'fake' })
  assert.deepEqual(result, { PATH: 'fake' })
})
test('memory explícito, dotenv público sin override/debug y Algolia ficticio antes de imports', () => {
  const result = stackEnvironment({ COMMERCE_STORE_MODE: 'postgresql', DATABASE_URL: 'fake', DOTENV_CONFIG_PATH: '.env',
    DOTENV_CONFIG_OVERRIDE: 'true', DOTENV_CONFIG_DEBUG: 'true', ALGOLIA_ORDERS_API_KEY: 'fake' })
  assert.equal(result.COMMERCE_STORE_MODE, 'memory'); assert.equal(result.DATABASE_URL, '')
  assert.equal(result.DOTENV_CONFIG_PATH, dotenvPath); assert.equal(result.RUN_DATABASE_INTEGRATION_TESTS, '0')
  assert.equal(result.ALGOLIA_ORDERS_API_KEY, ''); assert.equal(result.ALGOLIA_ORDERS_RECONCILE_ON_START, 'false')
  assert.equal('DOTENV_CONFIG_OVERRIDE' in result, false); assert.equal('DOTENV_CONFIG_DEBUG' in result, false)
})
test('un destino QA_DATABASE_URL requiere autorización adicional y no activa PostgreSQL', () => {
  assert.throws(() => stackEnvironment({ QA_DATABASE_URL: 'postgresql://fake@127.0.0.1:5432/fake' }), /NOT_AUTHORIZED/)
})
test('solo se emula el sondeo exacto de Vite, sin permitir subprocesses', () => {
  assert.equal(compilerMappingProbe('exec', ['net use', { windowsHide: true }, () => {}]), true)
  for (const command of ['net use /delete', 'net use \\\\example.invalid', 'node seedUsers.js']) assert.equal(compilerMappingProbe('exec', [command, { windowsHide: true }, () => {}]), false)
  assert.equal(compilerMappingProbe('spawn', ['net use', { windowsHide: true }, () => {}]), false)
})
test('solo los dos sockets locales autorizados', () => {
  for (const port of [3001, 4173]) assert.doesNotThrow(() => assertLocalSocket([port, '127.0.0.1']))
  for (const args of [[5432, '127.0.0.1'], [443, 'example.invalid'], [3001, 'localhost'], [{ path: 'pipe' }]]) assert.throws(() => assertLocalSocket(args), /NETWORK_BLOCKED/)
})
test('el navegador solo solicita los orígenes propios', () => {
  assert.equal(localBrowserUrl(CLIENT + BASE), true); assert.equal(localBrowserUrl(API + '/api/users'), true)
  for (const url of ['https://example.invalid', 'http://127.0.0.1:5432/', 'http://localhost:4173/', 'file:///fake']) assert.equal(localBrowserUrl(url), false)
})
test('archivos estáticos contenidos en el build temporal, sin traversal', () => {
  const root = resolve('fake-build')
  assert.equal(staticFile(root, BASE), resolve(root, 'index.html'))
  assert.equal(staticFile(root, BASE + 'assets/app.js'), resolve(root, 'assets/app.js'))
  for (const url of [BASE + '%2e%2e/private', BASE + '%2e%2e%5cprivate', BASE + '%00', '/private']) assert.equal(staticFile(root, url), undefined)
})
test('Client build no carga configuración privada ni Vite config productivo', () => {
  const source = readFileSync(new URL('./stack.mjs', import.meta.url), 'utf8')
  assert.match(source, /configFile: false, envDir: false/)
  assert.ok(source.indexOf('installStackIsolation()') < source.indexOf("requireServer('pg')"))
})
test('el recorrido no guarda capturas, videos ni archivos de resultados', () => {
  const source = readFileSync(new URL('./ui-e2e.mjs', import.meta.url), 'utf8')
  assert.doesNotMatch(source, /\.screenshot\(|writeFile\(|mkdir\(|recordVideo:|tracing\./)
})
