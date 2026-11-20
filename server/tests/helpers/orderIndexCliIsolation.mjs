/** Preload exclusivo de los subprocesses CN-65: audita dotenv y bloquea conexiones antes de abrir sockets. */
import fs from 'node:fs'
import net from 'node:net'
import tls from 'node:tls'
import { basename, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { syncBuiltinESMExports } from 'node:module'

const expected = resolve(process.env.CN65_CLI_EXPECTED_DOTENV)
const fixture = resolve(process.env.CN65_CLI_FIXTURE_DOTENV)
const audit = { environmentReads: 0, unexpectedEnvironmentReads: 0, networkAttempts: 0 }
const readFileSync = fs.readFileSync
fs.readFileSync = function (file, ...options) {
  const path = file instanceof URL ? fileURLToPath(file) : typeof file === 'string' ? resolve(file) : undefined
  if (path && (path === expected || basename(path) === '.env' || basename(path).startsWith('.env.'))) {
    audit.environmentReads++
    if (path !== expected) {
      audit.unexpectedEnvironmentReads++
      throw new Error('CN65_CLI_UNEXPECTED_ENVIRONMENT_READ')
    }
    // La prueba del default manual simula esa ruta con un archivo ficticio. Nunca abre la ruta privada.
    return readFileSync.call(this, fixture, ...options)
  }
  return readFileSync.call(this, file, ...options)
}
const blockNetwork = () => {
  audit.networkAttempts++
  throw new Error('CN65_CLI_NETWORK_BLOCKED')
}
net.Socket.prototype.connect = blockNetwork
tls.connect = blockNetwork
globalThis.fetch = blockNetwork
syncBuiltinESMExports()
process.on('exit', () => {
  if (audit.unexpectedEnvironmentReads || audit.networkAttempts) process.exitCode = 1
  process.stderr.write(`CN65_CLI_AUDIT ${JSON.stringify(audit)}\n`)
})
