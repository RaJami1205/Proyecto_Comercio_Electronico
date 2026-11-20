/** Primer import de CADA suite PG. No importa App, pg ni dotenv y no abre conexiones. */
import fs from 'node:fs'
import net from 'node:net'
import tls from 'node:tls'
import dgram from 'node:dgram'
import childProcess from 'node:child_process'
import { registerHooks, syncBuiltinESMExports } from 'node:module'
import { assertIntegrationConnection, assertIntegrationListener, assertIntegrationModule, assertIntegrationRead,
  isolatedIntegrationEnvironment } from './postgresIntegrationHarness.mjs'
import { manageServerProcess, serverProcessOptions } from './postgresServerProcess.mjs'

// Capacidad privada: el bloqueo global de subprocesses permanece intacto.
const forkServer = childProcess.fork.bind(childProcess)

const environment = isolatedIntegrationEnvironment(process.env)
for (const key of Object.keys(process.env)) delete process.env[key]
Object.assign(process.env, environment)
const enabled = environment.RUN_DATABASE_INTEGRATION_TESTS === '1'
const httpPorts = new Set()
/** Solo el hijo TEST-ONLY fijo y el entorno efímero validado; nunca argumentos/comandos arbitrarios. */
export function startIntegrationServer(run) {
  const options = serverProcessOptions(run, process.env)
  const child = forkServer(new URL('./postgresServerChild.mjs', import.meta.url), [run], options)
  return manageServerProcess(child, httpPorts)
}
let violations = 0
// Aun si dotenv/SDK captura una excepción, el worker no puede terminar exitosamente.
const guard = operation => {
  try { return operation() } catch (error) { violations++; throw error }
}
const block = () => guard(() => { throw new Error('CN69_POSTGRES_EXTERNAL_OPERATION_BLOCKED') })

for (const [object, methods] of [[fs, ['readFileSync', 'readFile', 'openSync', 'open', 'createReadStream']],
  [fs.promises, ['readFile', 'open']]]) {
  for (const method of methods) {
    const original = object[method]
    object[method] = function (file, ...args) {
      guard(() => assertIntegrationRead(file))
      return original.call(this, file, ...args)
    }
  }
}
const connect = net.Socket.prototype.connect
net.Socket.prototype.connect = function (...args) {
  guard(() => assertIntegrationConnection(args, httpPorts, enabled))
  return connect.apply(this, args)
}
const listen = net.Server.prototype.listen
net.Server.prototype.listen = function (...args) {
  guard(() => assertIntegrationListener(args))
  this.once('listening', () => {
    const address = this.address()
    if (address && typeof address !== 'string') {
      httpPorts.add(address.port)
      this.once('close', () => httpPorts.delete(address.port))
    }
  })
  return listen.apply(this, args)
}
tls.connect = block
dgram.Socket.prototype.send = block
for (const method of ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork']) childProcess[method] = block
const fetch = globalThis.fetch
globalThis.fetch = function (input, ...args) {
  let url
  try { url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url) } catch { return block() }
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !httpPorts.has(Number(url.port))) return block()
  return fetch.call(this, input, ...args)
}
registerHooks({ resolve(specifier, context, nextResolve) {
  guard(() => assertIntegrationModule(specifier))
  const result = nextResolve(specifier, context)
  guard(() => assertIntegrationModule(result.url))
  return result
} })
syncBuiltinESMExports()
process.on('exit', () => {
  if (violations) process.exitCode = 1
  process.stderr.write(`CN69_POSTGRES_ISOLATION violations=${violations}\n`)
})
