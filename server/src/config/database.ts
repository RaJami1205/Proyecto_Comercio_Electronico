/** Lee configuración PostgreSQL bajo demanda. El módulo no abre conexiones ni consulta servicios. */
import type { PoolConfig } from 'pg'
import { DatabaseError } from '../db/databaseError.js'

type Environment = Record<string, string | undefined>

/** Reconoce exclusivamente los hosts locales admitidos para PostgreSQL aislado sin TLS. */
export function isLoopbackHost(host: string): boolean {
  return ['localhost', '127.0.0.1', '[::1]', '::1'].includes(host)
}

/** Valida opciones numéricas sin coerciones permisivas ni timeouts que desborden los timers de Node. */
function positiveInteger(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback
  if (!/^[1-9][0-9]*$/.test(value)) throw new DatabaseError('configuration')
  const number = Number(value)
  if (!Number.isSafeInteger(number) || number > 2147483647) throw new DatabaseError('configuration')
  return number
}

/** Centraliza TLS fuera de la URL para evitar que sslmode o certificados de la URL sustituyan su verificación. */
export function getDatabaseConfig(environment: Environment = process.env): PoolConfig {
  try {
    const raw = environment.DATABASE_URL?.trim()
    if (!raw) throw new DatabaseError('configuration')
    const url = new URL(raw)
    if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname || !url.username
      || !url.pathname.slice(1) || url.hash) throw new DatabaseError('configuration')
    const sslModes = url.searchParams.getAll('sslmode')
    if ([...url.searchParams.keys()].some(key => key !== 'sslmode') || sslModes.length > 1
      || (sslModes.length && !['require', 'verify-ca', 'verify-full', 'disable'].includes(sslModes[0]))) {
      throw new DatabaseError('configuration')
    }
    const mode = environment.DATABASE_SSL_MODE ?? (sslModes[0] === 'disable' ? 'disable' : 'verify-full')
    if (!['verify-full', 'disable'].includes(mode) || (mode === 'disable' && !isLoopbackHost(url.hostname))) {
      throw new DatabaseError('configuration')
    }
    if (sslModes.length && ((sslModes[0] === 'disable') !== (mode === 'disable'))) throw new DatabaseError('configuration')
    const port = url.port ? Number(url.port) : 5432
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new DatabaseError('configuration')
    return {
      host: url.hostname.replace(/^\[|\]$/g, ''), port,
      user: decodeURIComponent(url.username), password: decodeURIComponent(url.password),
      database: decodeURIComponent(url.pathname.slice(1)),
      ssl: mode === 'disable' ? false : { rejectUnauthorized: true, ...(environment.DATABASE_CA_CERT ? { ca: environment.DATABASE_CA_CERT } : {}) },
      max: positiveInteger(environment.DATABASE_POOL_MAX, 3),
      connectionTimeoutMillis: positiveInteger(environment.DATABASE_CONNECTION_TIMEOUT_MS, 5000),
      idleTimeoutMillis: positiveInteger(environment.DATABASE_IDLE_TIMEOUT_MS, 10000),
      statement_timeout: positiveInteger(environment.DATABASE_STATEMENT_TIMEOUT_MS, 15000),
      application_name: 'cibernova-server',
    }
  } catch { throw new DatabaseError('configuration') }
}

/** Exige opt-in y una URL de loopback propia de tests. Nunca utiliza DATABASE_URL como alternativa. */
export function getDatabaseTestConfig(environment: Environment = process.env): PoolConfig {
  try {
    if (environment.RUN_DATABASE_INTEGRATION_TESTS !== '1' || !environment.DATABASE_TEST_URL
      || !isLoopbackHost(new URL(environment.DATABASE_TEST_URL).hostname)) throw new DatabaseError('configuration')
    return getDatabaseConfig({ ...environment, DATABASE_URL: environment.DATABASE_TEST_URL,
      DATABASE_SSL_MODE: environment.DATABASE_TEST_SSL_MODE ?? 'disable' })
  } catch { throw new DatabaseError('configuration') }
}
