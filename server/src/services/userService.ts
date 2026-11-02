/** Consulta el índice users y entrega únicamente identidades válidas y habilitadas, sin crear sesiones. */
import { getAlgoliaClient } from '../config/algolia.js'
import { ConfigurationError, getAlgoliaUsersConfig } from '../config/env.js'
import { UserError } from '../domain/userError.js'
import { parseUserRecord, validateUserId } from '../domain/userValidation.js'
import type { ResolvedUser, UserId } from '../types/user.js'

const USER_ATTRIBUTES = ['displayName', 'role', 'enabled', 'company']
const MAX_LISTED_USERS = 100

type UsersIndexClient = Pick<ReturnType<typeof getAlgoliaClient>, 'getObject' | 'searchSingleIndex'>

/** Entrega records sin validar; find devuelve undefined cuando el usuario no existe. */
export interface UserDirectory {
  list(): Promise<unknown[]>
  find(userId: UserId): Promise<unknown>
}

/** Limita las lecturas al índice users; enabled se filtra en Server para no requerir cambios de settings. */
export function createAlgoliaUserDirectory(getClient: () => UsersIndexClient = getAlgoliaClient): UserDirectory {
  return {
    async list() {
      const { indexName } = getAlgoliaUsersConfig()
      const response = await getClient().searchSingleIndex<Record<string, unknown>>({
        indexName,
        searchParams: {
          query: '',
          hitsPerPage: MAX_LISTED_USERS,
          attributesToRetrieve: USER_ATTRIBUTES,
          attributesToHighlight: [],
        },
      })
      return response.hits
    },
    async find(userId) {
      const { indexName } = getAlgoliaUsersConfig()
      try {
        return await getClient().getObject({ indexName, objectID: userId, attributesToRetrieve: USER_ATTRIBUTES })
      } catch (error) {
        if (error !== null && typeof error === 'object' && 'status' in error && error.status === 404) return undefined
        throw error
      }
    },
  }
}

export class UserService {
  /** Recibe el directorio que el servicio utilizará para consultar los records de usuarios. */
  constructor(private readonly directory: UserDirectory = createAlgoliaUserDirectory()) {}

  /** Devuelve las identidades seleccionables y omite records deshabilitados o inválidos. */
  async listSelectable(): Promise<ResolvedUser[]> {
    const records = await this.query((directory) => directory.list())
    const users: ResolvedUser[] = []
    let invalidRecords = 0

    for (const record of records) {
      try {
        const { user, enabled } = parseUserRecord(record)
        if (enabled) users.push(user)
      } catch (error) {
        if (!(error instanceof UserError)) throw error
        invalidRecords += 1
      }
    }
    if (invalidRecords > 0) console.warn(`Se omitieron ${invalidRecords} records inválidos del índice users.`)

    return users
  }

  /** Valida el userId y devuelve el perfil público solo si el usuario existe y está habilitado. */
  async resolve(userId: unknown): Promise<ResolvedUser> {
    const id = validateUserId(userId)
    const record = await this.query((directory) => directory.find(id))
    if (record === undefined) throw new UserError(404, 'USER_NOT_FOUND', 'El usuario no existe.')

    const { user, enabled } = parseUserRecord(record)
    if (!enabled) throw new UserError(403, 'USER_DISABLED', 'El usuario está deshabilitado.')
    return user
  }

  /** Oculta el detalle de fallos del SDK porque sus errores pueden incluir información de requests. */
  private async query<T>(operation: (directory: UserDirectory) => Promise<T>): Promise<T> {
    try {
      return await operation(this.directory)
    } catch (error) {
      console.error(error instanceof ConfigurationError ? error.message : 'No se pudo consultar el índice users en Algolia.')
      throw new UserError(503, 'USER_SERVICE_UNAVAILABLE', 'El servicio de usuarios no está disponible.')
    }
  }
}

export const userService = new UserService()
