/** CN-69 TEST-ONLY: Browser QA local, sin PostgreSQL ni servicios remotos. */
import fs from 'node:fs'
import net from 'node:net'
import tls from 'node:tls'
import dgram from 'node:dgram'
import childProcess from 'node:child_process'
import { basename, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { registerHooks, syncBuiltinESMExports } from 'node:module'
export const ROOT = fileURLToPath(new URL('../../../', import.meta.url))
export const BASE = '/Proyecto_Comercio_Electronico/'
export const API = 'http://127.0.0.1:3001'
export const CLIENT = 'http://127.0.0.1:4173'
export const dotenvPath = resolve(ROOT, 'server/.env.database.example')
const fail = label => { throw new Error('CN69_BROWSER_' + label) }
export function operatingEnvironment(input) {
  const environment = {}
  for (const key of ['PATH', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'COMSPEC', 'PATHEXT']) if (input[key] !== undefined) environment[key] = input[key]
  return environment
}
export function stackEnvironment(input) {
  if (input.QA_DATABASE_URL) fail('DATABASE_NOT_AUTHORIZED')
  return { ...operatingEnvironment(input), NODE_ENV: 'test',
    DOTENV_CONFIG_PATH: dotenvPath, DOTENV_CONFIG_QUIET: 'true', DOTENV_KEY: '', DOTENV_CONFIG_DOTENV_KEY: '',
    COMMERCE_STORE_MODE: 'memory', ORDER_CREATION_MODE: 'v2-only', DATABASE_URL: '',
    DATABASE_TEST_URL: '', DATABASE_RUNTIME_TEST_URL: '', RUN_DATABASE_INTEGRATION_TESTS: '0',
    ALGOLIA_APP_ID: 'QA_FAKE_APP', ALGOLIA_API_KEY: 'qa-fake-key',
    ALGOLIA_INDEX_NAME: 'qa_products', ALGOLIA_USERS_INDEX_NAME: 'qa_users',
    ALGOLIA_ORDERS_INDEX_NAME: '', ALGOLIA_ORDERS_API_KEY: '', ALGOLIA_ORDERS_SETTINGS_API_KEY: '',
    ALGOLIA_SEED_API_KEY: '', ALGOLIA_ORDERS_RECONCILE_ON_START: 'false', CLIENT_ORIGIN: CLIENT, PORT: '3001' }
}
export function localBrowserUrl(value) {
  try { return [CLIENT, API].includes(new URL(value).origin) } catch { return false }
}
export function staticFile(root, requestPath) {
  const pathname = new URL(requestPath, CLIENT).pathname
  if (!pathname.startsWith(BASE)) return undefined
  let relative
  try { relative = decodeURIComponent(pathname.slice(BASE.length)) } catch { return undefined }
  if (relative.includes('\0')) return undefined
  const file = resolve(root, relative || 'index.html')
  return file.startsWith(resolve(root) + sep) ? file : undefined
}
export function assertLocalSocket(args) {
  const first = Array.isArray(args[0]) ? args[0][0] : args[0]
  const options = typeof first === 'object' && first !== null ? first : { port: first, host: args[1] }
  if (options.path || options.host !== '127.0.0.1' || ![3001, 4173].includes(Number(options.port))) fail('NETWORK_BLOCKED')
}
export function compilerMappingProbe(method, args) {
  return method === 'exec' && args[0] === 'net use' && args[1]?.windowsHide === true && typeof args[2] === 'function'
}
export function installStackIsolation() {
  const environment = stackEnvironment(process.env)
  for (const key of Object.keys(process.env)) delete process.env[key]
  Object.assign(process.env, environment)
  const audit = { privateEnv: 0, network: 0, maintenance: 0 }
  const blocked = kind => { audit[kind]++; return fail(kind.toUpperCase() + '_BLOCKED') }
  for (const [object, methods] of [[fs, ['readFileSync', 'readFile', 'openSync', 'open', 'createReadStream']], [fs.promises, ['readFile', 'open']]]) for (const method of methods) {
    const original = object[method]
    object[method] = function (file, ...args) {
      const name = file instanceof URL ? fileURLToPath(file) : typeof file === 'string' || Buffer.isBuffer(file) ? resolve(String(file)) : undefined
      if (name && /^\.env(?:\.|$)/i.test(basename(name)) && name !== dotenvPath) return blocked('privateEnv')
      return original.call(this, file, ...args)
    }
  }
  const connect = net.Socket.prototype.connect
  net.Socket.prototype.connect = function (...args) { try { assertLocalSocket(args) } catch { return blocked('network') }; return connect.apply(this, args) }
  tls.connect = () => blocked('network')
  dgram.Socket.prototype.send = () => blocked('network')
  globalThis.fetch = () => blocked('network')
  const listen = net.Server.prototype.listen
  net.Server.prototype.listen = function (...args) { if (![3001, 4173].includes(args[0]) || args[1] !== '127.0.0.1') return blocked('network'); return listen.apply(this, args) }
  for (const method of ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork']) childProcess[method] = (...args) => {
    // Vite sondea unidades UNC en Windows. Este repo local no necesita mapas: NO se ejecuta net.exe.
    if (compilerMappingProbe(method, args)) { queueMicrotask(() => args[2](null, '', '')); return undefined }
    return blocked('maintenance')
  }
  registerHooks({ resolve(specifier, context, next) { const result = next(specifier, context); if (/(?:src|dist)[/\\]scripts[/\\]/i.test(result.url)) return blocked('maintenance'); return result } })
  syncBuiltinESMExports()
  process.on('exit', () => { if (Object.values(audit).some(Boolean)) process.exitCode = 1; console.error('CN69_BROWSER_STACK_AUDIT ' + JSON.stringify(audit)) })
  return audit
}
