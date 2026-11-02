/** Consulta el índice users y entrega únicamente identidades válidas y habilitadas, sin crear sesiones. */
import { getAlgoliaClient } from '../config/algolia.js'
import { ConfigurationError, getAlgoliaUsersConfig } from '../config/env.js'
import { UserError } from '../domain/userError.js'
import { parseUserRecord, validateUserId } from '../domain/userValidation.js'
import type { ResolvedUser, UserId } from '../types/user.js'

const USER_ATTRIBUTES = ['displayName', 'role', 'enabled', 'company']
const USERS_PAGE_SIZE = 100

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
      const client = getClient()
      const records: unknown[] = []
      const objectIds = new Set<string>()
      let pageCount = 1
      let hitCount = 0

      for (let page = 0; page < pageCount; page += 1) {
        const response = await client.searchSingleIndex<Record<string, unknown>>({
          indexName,
          searchParams: {
            query: '', page, hitsPerPage: USERS_PAGE_SIZE,
            attributesToRetrieve: USER_ATTRIBUTES,
            attributesToHighlight: [],
          },
        })
        const { nbHits, nbPages } = response
        if (typeof nbHits !== 'number' || !Number.isSafeInteger(nbHits) || nbHits < 0 ||
            typeof nbPages !== 'number' || !Number.isSafeInteger(nbPages) || nbPages < 0 ||
            response.page !== page || response.hitsPerPage !== USERS_PAGE_SIZE || !Array.isArray(response.hits) ||
            (response.exhaustive?.nbHits ?? response.exhaustiveNbHits) !== true) {
          throw new Error('No se pudo verificar un listado completo de usuarios.')
        }
        // paginationLimitedTo puede impedir recuperar todos los hits aun cuando nbHits sea exacto.
        if (nbPages !== Math.ceil(nbHits / USERS_PAGE_SIZE)) {
          throw new Error('El listado de usuarios está limitado por la paginación de Algolia.')
        }
        if (page === 0) {
          pageCount = nbPages
          hitCount = nbHits
        } else if (nbPages !== pageCount || nbHits !== hitCount) {
          throw new Error('El listado de usuarios cambió durante la paginación.')
        }
        if (response.hits.length !== Math.min(USERS_PAGE_SIZE, Math.max(0, hitCount - page * USERS_PAGE_SIZE))) {
          throw new Error('Algolia devolvió una página incompleta de usuarios.')
        }
        for (const record of response.hits) {
          if (record !== null && typeof record === 'object' && typeof record.objectID === 'string') {
            if (objectIds.has(record.objectID)) throw new Error('Algolia devolvió usuarios repetidos durante la paginación.')
            objectIds.add(record.objectID)
          }
          records.push(record)
        }
      }
      return records
    },
    async find(userId) {
      const { indexName } = getAlgoliaUsersConfig()
      const client = getClient()
      try {
        return await client.getObject({ indexName, objectID: userId, attributesToRetrieve: USER_ATTRIBUTES })
      } catch (error) {
        if (error !== null && typeof error === 'object' && 'status' in error && error.status === 404) {
          // indexExists usa getSettings en este SDK. La búsqueda vacía conserva los permisos de lectura actuales.
          await client.searchSingleIndex({
            indexName,
            searchParams: { query: '', hitsPerPage: 0, attributesToRetrieve: [], attributesToHighlight: [] },
          })
          return undefined
        }
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

    return users.sort((first, second) => first.id < second.id ? -1 : first.id > second.id ? 1 : 0)
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
