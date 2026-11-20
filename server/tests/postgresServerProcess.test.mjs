/** CN-69: pruebas puras del reinicio de procesos. Sin PostgreSQL, sockets ni dotenv privado. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { manageServerProcess, serverProcessOptions } from './helpers/postgresServerProcess.mjs'
import { publicDotenv } from './helpers/postgresIntegrationHarness.mjs'

const run = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const input = () => ({ RUN_DATABASE_INTEGRATION_TESTS: '1',
  DATABASE_TEST_URL: 'postgresql://cn_test_admin:fake-admin@127.0.0.1:5432/cibernova_test',
  DATABASE_RUNTIME_TEST_URL: 'postgresql://cibernova_app:fake-runtime@127.0.0.1:5432/cibernova_test',
  CN69_POSTGRES_CONTAINER_ID: 'a'.repeat(64), CN69_POSTGRES_SERVER_ADDRESS: '172.18.0.2' })
/** Doble de IPC/exit sin proceso real: los timers prueban el controlador, no una conexión ni persistencia PostgreSQL. */
class Child extends EventEmitter {
  pid = 12345
  connected = true
  sends = []
  kills = []
  exit(code = 0, signal = null) { this.connected = false; this.emit('exit', code, signal) }
  send(message, callback) {
    this.sends.push(message)
    callback?.(null)
    if (message === 'cn69-server-stop') queueMicrotask(() => this.exit())
  }
  kill(signal) { this.kills.push(signal); queueMicrotask(() => this.exit(null, signal)) }
}
const announced = child => ({ type: 'cn69-server-ready', pid: child.pid, port: 41001, storage: 'postgresql', verified: true })

test('el hijo recibe únicamente el entorno efímero validado, sin flags Node ni secretos heredados', () => {
  const options = serverProcessOptions(run, { ...input(), NODE_OPTIONS: '--require private', NODE_TEST_CONTEXT: 'child-v8',
    DATABASE_URL: 'private-placeholder', PGPASSWORD: 'private-placeholder', HTTP_PROXY: 'private-placeholder', DOTENV_CONFIG_PATH: '.env' })
  assert.deepEqual(options.execArgv, [])
  assert.equal(options.env.DOTENV_CONFIG_PATH, publicDotenv)
  assert.equal(options.env.DATABASE_URL, '')
  assert.equal(options.env.COMMERCE_STORE_MODE, 'memory', 'La composición global no se debilita para habilitar hijos')
  assert.equal(options.env.ALGOLIA_ORDERS_RECONCILE_ON_START, 'false')
  for (const key of ['NODE_OPTIONS', 'NODE_TEST_CONTEXT', 'PGPASSWORD', 'HTTP_PROXY']) assert.equal(key in options.env, false)
  assert.deepEqual(options.stdio, ['ignore', 'ignore', 'inherit', 'ipc'])
})

for (const [name, patch] of Object.entries({ noOptIn: { RUN_DATABASE_INTEGRATION_TESTS: '0' },
  remote: { DATABASE_RUNTIME_TEST_URL: 'postgresql://cibernova_app:fake@db.example.invalid:5432/cibernova_test' },
  noContainer: { CN69_POSTGRES_CONTAINER_ID: '' }, noAddress: { CN69_POSTGRES_SERVER_ADDRESS: '' } })) {
  test('falla antes de arrancar el hijo ante ' + name, () => {
    assert.throws(() => serverProcessOptions(run, { ...input(), ...patch }), /CN69_POSTGRES_/)
  })
}
test('el único argumento del hijo es un UUID V4 sintético válido', () => {
  for (const value of ['', '../scripts/seedUsers.js', '--eval', undefined]) assert.throws(() => serverProcessOptions(value, input()), /SERVER_RUN/)
})
test('el entry point real rechaza falta de opt-in sin leer dotenv ni abrir sockets', () => {
  const guard = `import fs from 'node:fs'; import net from 'node:net'; import tls from 'node:tls';
    import {basename} from 'node:path'; import {syncBuiltinESMExports} from 'node:module';
    let env=0, network=0; const read=fs.readFileSync;
    fs.readFileSync=function(file,...args){if(/^\\.env(?:\\.|$)/i.test(basename(String(file)))){env++;throw new Error('PRIVATE_ENV_BLOCKED')}return read.call(this,file,...args)};
    net.Socket.prototype.connect=tls.connect=()=>{network++;throw new Error('NETWORK_BLOCKED')};
    syncBuiltinESMExports(); process.on('exit',()=>console.error('CN69_CHILD_GUARD '+JSON.stringify({env,network})));`
  const options = serverProcessOptions(run, input())
  const result = spawnSync(process.execPath, ['--import', 'data:text/javascript;base64,' + Buffer.from(guard).toString('base64'),
    fileURLToPath(new URL('./helpers/postgresServerChild.mjs', import.meta.url)), run], {
    env: { ...options.env, RUN_DATABASE_INTEGRATION_TESTS: '0' }, encoding: 'utf8', timeout: 10000,
  })
  assert.equal(result.error, undefined)
  assert.equal(result.status, 1)
  assert.equal(result.stdout, '')
  assert.match(result.stderr, /CN69_POSTGRES_SERVER_START_FAILED/)
  assert.match(result.stderr, /CN69_CHILD_GUARD \{"env":0,"network":0\}/)
  assert.match(result.stderr, /CN69_POSTGRES_ISOLATION violations=0/)
  assert.doesNotMatch(result.stderr, /postgresql:\/\//)
})
test('un puerto HTTP solo se registra después del ready verificado y se elimina al observar exit', async () => {
  const child = new Child(), ports = new Set(), handle = manageServerProcess(child, ports)
  assert.equal(ports.size, 0)
  child.emit('message', announced(child))
  assert.deepEqual(await handle.ready, { pid: child.pid, base: 'http://127.0.0.1:41001', storage: 'postgresql' })
  assert.equal(ports.has(41001), true)
  assert.equal(handle.terminated, false)
  await handle.stop(); await handle.stop()
  assert.equal(handle.terminated, true)
  assert.equal(ports.size, 0)
  assert.deepEqual(child.sends, ['cn69-server-stop'])
  assert.deepEqual(child.kills, [], 'El cierre normal espera cleanup y no mata prematuramente')
})
for (const patch of [{ pid: 999 }, { verified: false }, { storage: 'memory' }, { port: 5432 }, { port: '41001' }]) {
  test('no autoriza HTTP ante anuncio de identidad inválida: ' + JSON.stringify(patch), async () => {
    const child = new Child(), ports = new Set(), handle = manageServerProcess(child, ports)
    const rejected = assert.rejects(handle.ready, /SERVER_IDENTITY/)
    child.emit('message', { ...announced(child), ...patch })
    await rejected
    assert.equal(ports.size, 0)
    await handle.stop()
  })
}
test('un ready tardío no autoriza puertos después del timeout', async () => {
  const child = new Child(), ports = new Set(), handle = manageServerProcess(child, ports, 10)
  await assert.rejects(handle.ready, /READY_TIMEOUT/)
  child.emit('message', announced(child))
  assert.equal(ports.size, 0)
  await handle.stop()
})
test('una salida fallida rechaza ready y no comunica cleanup exitoso', async () => {
  const child = new Child(), handle = manageServerProcess(child, new Set())
  const rejected = assert.rejects(handle.ready, /EARLY_EXIT/)
  child.exit(1)
  await rejected
  await assert.rejects(handle.stop(), /CLEANUP/)
})
test('un error de IPC no se confunde con la terminación de un proceso vivo', async () => {
  const child = new Child(), ports = new Set(), handle = manageServerProcess(child, ports)
  child.emit('message', announced(child)); await handle.ready
  child.emit('error', new Error('IPC ficticio'))
  assert.equal(handle.terminated, false)
  assert.equal(ports.has(41001), true)
  await assert.rejects(handle.stop(), /CLEANUP/)
  assert.equal(handle.terminated, true)
  assert.equal(ports.size, 0)
  assert.deepEqual(child.sends, ['cn69-server-stop'])
})
test('un hijo que no cierra se termina de forma acotada y causa fallo del test', async () => {
  const child = new Child(), ports = new Set(), handle = manageServerProcess(child, ports, 10)
  child.send = () => {}
  child.emit('message', announced(child)); await handle.ready
  await assert.rejects(handle.stop(), /STOP_TIMEOUT/)
  assert.deepEqual(child.kills, ['SIGKILL'])
  assert.equal(handle.terminated, true)
  assert.equal(ports.size, 0)
})
test('contadores IPC no invocan catálogo ni Sandbox y se mantienen en memoria', async () => {
  const child = new Child(), handle = manageServerProcess(child, new Set())
  child.emit('message', announced(child)); await handle.ready
  const counts = handle.counts()
  child.emit('message', { type: 'cn69-server-counts', catalog: 0, payments: 0 })
  assert.deepEqual(await counts, { catalog: 0, payments: 0 })
  await handle.stop()
})
test('entry point fijo y aislamiento antes de imports, verificación PostgreSQL antes de escuchar', () => {
  const isolation = readFileSync(new URL('./helpers/postgresIntegrationIsolation.mjs', import.meta.url), 'utf8')
  assert.match(isolation, /forkServer\(new URL\('\.\/postgresServerChild\.mjs', import.meta.url\), \[run\], options\)/)
  assert.match(isolation, /childProcess\[method\] = block/)
  const child = readFileSync(new URL('./helpers/postgresServerChild.mjs', import.meta.url), 'utf8')
  assert.ok(child.indexOf("import './postgresIntegrationIsolation.mjs'") < child.indexOf("import('../../dist/db/pool.js')"))
  assert.ok(child.indexOf('await verifyIntegrationDatabases(db)') < child.indexOf('app.listen('))
  assert.match(child, /await db\?\.close\(\)/)
  assert.doesNotMatch(child, /process\.exit\(|writeFile|\.screenshot\(|recordVideo/)
})
