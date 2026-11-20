/** Resuelve la identidad simulada por request y aplica los roles de cada operación protegida. */
import type { NextFunction, Request, Response } from 'express'
import { requireAnyPermission, type Permission } from '../domain/orderAccess.js'
import { UserError } from '../domain/userError.js'
import { userService } from '../services/userService.js'
import type { ResolvedUser, UserRole } from '../types/user.js'

export type AuthorizedResponse = Response<unknown, { user: ResolvedUser }>
export type OptionalIdentityResponse = Response<unknown, { user: ResolvedUser | null }>

/** Resuelve el rol desde UserService cuando el catálogo recibe userId; sin identidad usa precio retail. */
export function resolveOptionalIdentity() {
  return async (request: Request, response: OptionalIdentityResponse, next: NextFunction): Promise<void> => {
    try {
      const headers = (request.rawHeaders ?? []).filter((header, index) => index % 2 === 0 && header.toLowerCase() === 'x-cibernova-user-id')
      if (headers.length === 0) {
        response.locals.user = null
        next()
        return
      }
      const userId = request.headers['x-cibernova-user-id']
      if (headers.length !== 1 || typeof userId !== 'string') throw new UserError(400, 'INVALID_USER_ID', 'El header de identidad no es válido.')
      response.locals.user = await userService.resolve(userId)
      next()
    } catch (error) { next(error) }
  }
}

/** Exige un único header sin ambigüedad y obtiene rol/estado exclusivamente desde UserService. */
async function resolveRequiredIdentity(request: Request): Promise<ResolvedUser> {
  const headers = (request.rawHeaders ?? []).filter((header, index) => index % 2 === 0 && header.toLowerCase() === 'x-cibernova-user-id')
  if (headers.length === 0) throw new UserError(401, 'IDENTITY_REQUIRED', 'Selecciona una identidad para realizar esta operación.')
  const userId = request.headers['x-cibernova-user-id']
  if (headers.length !== 1 || typeof userId !== 'string') throw new UserError(400, 'INVALID_USER_ID', 'El header de identidad no es válido.')
  return userService.resolve(userId)
}

/** Resuelve la identidad y exige uno de los roles indicados. */
export function authorizeRoles(...roles: UserRole[]) {
  return async (request: Request, response: AuthorizedResponse, next: NextFunction): Promise<void> => {
    try {
      const user = await resolveRequiredIdentity(request)
      if (!roles.includes(user.role)) throw new UserError(403, 'FORBIDDEN', 'Esta identidad no tiene permiso para realizar la operación.')
      response.locals.user = user
      next()
    } catch (error) { next(error) }
  }
}

/** Resuelve una identidad válida de cualquier rol; cada ruta exige después sus permisos con requirePermissions. */
export function authorizeIdentity() {
  return async (request: Request, response: AuthorizedResponse, next: NextFunction): Promise<void> => {
    try {
      response.locals.user = await resolveRequiredIdentity(request)
      next()
    } catch (error) { next(error) }
  }
}

/** Exige al menos uno de los permisos RBAC sobre la identidad ya resuelta, sin volver a consultar UserService. */
export function requirePermissions(...permissions: Permission[]) {
  return (_request: Request, response: AuthorizedResponse, next: NextFunction): void => {
    try {
      const user: unknown = response.locals.user
      if (user === undefined || user === null) throw new UserError(401, 'IDENTITY_REQUIRED', 'Selecciona una identidad para realizar esta operación.')
      requireAnyPermission(response.locals.user, ...permissions)
      next()
    } catch (error) { next(error) }
  }
}
