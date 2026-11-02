/** Consume las identidades simuladas de CN-52; no crea credenciales ni persiste sesiones. */
import type { ResolvedUser } from '../types/user'
import type { ApiErrorCode } from '../types/apiError'

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL?.trim() || '').replace(/\/+$/, '')
const ERROR_CODES: readonly ApiErrorCode[] = ['INVALID_USER_ID', 'USER_NOT_FOUND', 'USER_DISABLED',
  'UNKNOWN_USER_ROLE', 'INVALID_USER_DATA', 'INVALID_B2B_DATA', 'USER_SERVICE_UNAVAILABLE']

export class SessionApiError extends Error {
  readonly code: ApiErrorCode
  constructor(code: ApiErrorCode) {
    super('No se pudo resolver la identidad simulada.')
    this.name = 'SessionApiError'
    this.code = code
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function text(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

/** Proyecta exclusivamente los campos públicos y valida las variantes de CN-51. */
function parseUser(value: unknown): ResolvedUser {
  if (!isRecord(value) || !text(value.id) || !text(value.displayName)) throw new SessionApiError('INVALID_USER_DATA')
  const identity = { id: value.id, displayName: value.displayName }
  if (value.role === 'B2B') {
    if (!isRecord(value.company) || !text(value.company.id) || !text(value.company.name)) {
      throw new SessionApiError('INVALID_B2B_DATA')
    }
    return { ...identity, role: 'B2B', company: { id: value.company.id, name: value.company.name } }
  }
  if (value.role !== 'B2C' && value.role !== 'ADMIN') throw new SessionApiError('UNKNOWN_USER_ROLE')
  if (value.company !== undefined) throw new SessionApiError('INVALID_USER_DATA')
  return { ...identity, role: value.role }
}

async function request(path: string, signal: AbortSignal, userId?: string): Promise<Record<string, unknown>> {
  const response = await fetch(API_BASE_URL + path, {
    method: userId === undefined ? 'GET' : 'POST',
    headers: { Accept: 'application/json', ...(userId === undefined ? {} : { 'Content-Type': 'application/json' }) },
    ...(userId === undefined ? {} : { body: JSON.stringify({ userId }) }),
    signal: AbortSignal.any([signal, AbortSignal.timeout(20000)]),
  })
  const body: unknown = await response.json().catch(() => null)
  if (response.status !== 200) {
    const code = isRecord(body) && isRecord(body.error) ? body.error.code : undefined
    throw new SessionApiError(ERROR_CODES.includes(code as ApiErrorCode) ? code as ApiErrorCode : 'UNEXPECTED_ERROR')
  }
  if (!isRecord(body)) throw new SessionApiError('UNEXPECTED_ERROR')
  return body
}

export const sessionApi = {
  async listUsers(signal: AbortSignal): Promise<ResolvedUser[]> {
    const body = await request('/api/users', signal)
    if (!Array.isArray(body.users)) throw new SessionApiError('INVALID_USER_DATA')
    const users = body.users.map(parseUser)
    if (new Set(users.map(user => user.id)).size !== users.length) throw new SessionApiError('INVALID_USER_DATA')
    return users
  },
  async resolveUser(userId: string, signal: AbortSignal): Promise<ResolvedUser> {
    if (!userId.trim()) throw new SessionApiError('INVALID_USER_ID')
    const body = await request('/api/session/resolve', signal, userId)
    const user = parseUser(body.user)
    if (user.id !== userId) throw new SessionApiError('INVALID_USER_DATA')
    return user
  },
}

export function sessionErrorMessage(error: unknown): string {
  if (error instanceof SessionApiError) {
    if (error.code === 'USER_DISABLED') return 'Esta identidad está deshabilitada. Selecciona otra.'
    if (error.code === 'USER_NOT_FOUND') return 'La identidad ya no está disponible. Actualiza la lista.'
    if (error.code === 'INVALID_USER_ID') return 'Selecciona una identidad válida.'
    if (error.code === 'USER_SERVICE_UNAVAILABLE') return 'El servicio de identidades no está disponible. Intenta de nuevo.'
  }
  return 'No se pudo validar la identidad. Conservamos la sesión y el carrito anteriores. Intenta de nuevo.'
}
