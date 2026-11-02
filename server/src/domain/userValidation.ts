/** Valida identificadores y records del índice users antes de convertirlos en identidades públicas. */
import type { Company, ResolvedUser, UserId, UserRole } from '../types/user.js'
import { UserError } from './userError.js'

const USER_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/
const REQUIRED_SEED_ROLES: readonly UserRole[] = ['B2C', 'B2B', 'ADMIN']
const SEED_RECORD_FIELDS = new Set(['objectID', 'displayName', 'role', 'enabled', 'company'])
const SEED_COMPANY_FIELDS = new Set(['id', 'name'])

/** Separa el perfil público de enabled, que solo existe en el record de Server. */
export interface UserDirectoryEntry {
  user: ResolvedUser
  enabled: boolean
}

/** Descarta null y arrays antes de inspeccionar campos de datos externos. */
function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Exige contenido no vacío para nombres e identificadores de empresa. */
function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

/** Crea el error común de un record que no cumple la forma de identidad. */
function invalidUserData(): UserError {
  return new UserError(422, 'INVALID_USER_DATA', 'Los datos del usuario no son válidos.')
}

/** Exige Company completa para B2B según el contrato aprobado. */
function parseCompany(value: unknown): Company {
  if (!isObject(value) || !isNonEmptyString(value.id) || !isNonEmptyString(value.name)) {
    throw new UserError(422, 'INVALID_B2B_DATA', 'La información empresarial del usuario no es válida.')
  }
  return { id: value.id.trim(), name: value.name.trim() }
}

/** Rechaza entradas que no sean un identificador estable antes de consultar Algolia. */
export function validateUserId(value: unknown): UserId {
  if (typeof value !== 'string' || !USER_ID_PATTERN.test(value)) {
    throw new UserError(400, 'INVALID_USER_ID', 'El identificador de usuario no es válido.')
  }
  return value
}

/** Construye el perfil campo por campo para que ningún atributo adicional del índice llegue al Client. */
export function parseUserRecord(value: unknown): UserDirectoryEntry {
  if (!isObject(value) || typeof value.objectID !== 'string' || !USER_ID_PATTERN.test(value.objectID) ||
      !isNonEmptyString(value.displayName) || typeof value.enabled !== 'boolean') {
    throw invalidUserData()
  }

  const { role, enabled } = value
  const identity = { id: value.objectID, displayName: value.displayName.trim() }

  if (role !== 'B2C' && role !== 'B2B' && role !== 'ADMIN') {
    throw new UserError(422, 'UNKNOWN_USER_ROLE', 'El rol del usuario no está reconocido.')
  }
  if (role === 'B2B') return { enabled, user: { ...identity, role, company: parseCompany(value.company) } }
  if (value.company !== undefined) throw invalidUserData()
  return { enabled, user: { ...identity, role } }
}

/** Reúne los errores del dataset sin volcar sus valores; también bloquea campos fuera del contrato. */
export function findUserSeedErrors(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0) return ['se requiere un array no vacío']

  const errors: string[] = []
  const ids = new Set<string>()
  const enabledRoles = new Set<UserRole>()

  value.forEach((record: unknown, index: number) => {
    const position = `record ${index + 1}`
    if (isObject(record)) {
      const unknownFields = Object.keys(record).filter((field) => !SEED_RECORD_FIELDS.has(field))
      const companyFields = isObject(record.company) ? Object.keys(record.company) : []
      unknownFields.push(...companyFields.filter((field) => !SEED_COMPANY_FIELDS.has(field)).map((field) => `company.${field}`))
      for (const field of unknownFields) errors.push(`${position}: campo no permitido ${field}`)
    }

    try {
      const { user, enabled } = parseUserRecord(record)
      if (ids.has(user.id)) errors.push(`${position}: objectID duplicado`)
      ids.add(user.id)
      if (enabled) enabledRoles.add(user.role)
    } catch (error) {
      if (!(error instanceof UserError)) throw error
      errors.push(`${position}: ${error.code}`)
    }
  })

  for (const role of REQUIRED_SEED_ROLES) {
    if (!enabledRoles.has(role)) errors.push(`falta un usuario habilitado con rol ${role}`)
  }
  return errors
}
