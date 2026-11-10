/** Clasifica fallos de PostgreSQL sin conservar SQL, parámetros, credenciales ni mensajes del driver. */
export type DatabaseErrorKind = 'configuration' | 'unavailable' | 'timeout' | 'constraint' | 'transaction' | 'uncertain-commit' | 'closed'
export type TransactionOutcome = 'not-committed' | 'rolled-back' | 'unknown'

const messages: Record<DatabaseErrorKind, string> = {
  configuration: 'La configuración de PostgreSQL no es válida.',
  unavailable: 'PostgreSQL no está disponible para completar la operación.',
  timeout: 'PostgreSQL no respondió dentro del tiempo permitido.',
  constraint: 'La operación incumple una restricción de PostgreSQL.',
  transaction: 'No se pudo completar la transacción de PostgreSQL.',
  'uncertain-commit': 'No se pudo confirmar el resultado de COMMIT.',
  closed: 'El Pool de PostgreSQL está cerrado.',
}

export class DatabaseError extends Error {
  constructor(public readonly kind: DatabaseErrorKind, public readonly outcome: TransactionOutcome = 'not-committed', public readonly sqlState?: string) {
    super(messages[kind])
    this.name = 'DatabaseError'
  }
}

/** Extrae únicamente un SQLSTATE de formato válido de un error desconocido. */
export function sqlStateOf(error: unknown): string | undefined {
  if (error instanceof DatabaseError) return error.sqlState
  if (error === null || typeof error !== 'object' || !('code' in error)) return undefined
  return typeof error.code === 'string' && /^[0-9A-Z]{5}$/.test(error.code) ? error.code : undefined
}

/** Un error de conexión durante COMMIT impide inferir si el servidor confirmó la escritura. */
export function isConnectionFailure(error: unknown): boolean {
  if (error instanceof DatabaseError) return error.kind === 'unavailable' || error.kind === 'uncertain-commit'
  const code = sqlStateOf(error)
  const nativeCode = error !== null && typeof error === 'object' && 'code' in error ? error.code : undefined
  return Boolean(code?.startsWith('08')) || ['57P01', '57P02', '57P03', '57P04', '57P05'].includes(code ?? '')
    || (typeof nativeCode === 'string' && ['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EPIPE', 'ENOTFOUND'].includes(nativeCode))
}

/** pg genera este Error exacto sin código para query_timeout; no aceptar coincidencias parciales ni SQLSTATE ajenos. */
export function isDriverQueryTimeout(error: unknown): boolean {
  return error instanceof Error && error.name === 'Error' && error.message === 'Query read timeout'
    && (!('code' in error) || error.code === undefined)
}

/** Mantiene errores propios y proyecta los del driver a categorías internas sanitizadas. */
export function databaseError(error: unknown, outcome: TransactionOutcome = 'not-committed', fallback: 'transaction' | 'unavailable' = 'transaction'): DatabaseError {
  if (error instanceof DatabaseError) return error
  const code = sqlStateOf(error)
  const kind = isDriverQueryTimeout(error) ? 'timeout' : code?.startsWith('23') ? 'constraint' : isConnectionFailure(error) ? 'unavailable' : code ? 'transaction' : fallback
  return new DatabaseError(kind, outcome, code)
}
