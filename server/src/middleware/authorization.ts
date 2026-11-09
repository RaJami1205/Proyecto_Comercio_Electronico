/** Resuelve la identidad simulada por request y aplica los roles de cada operación protegida. */
import type { NextFunction, Request, Response } from 'express'
import { UserError } from '../domain/userError.js'
import { userService } from '../services/userService.js'
import type { ResolvedUser, UserRole } from '../types/user.js'

export type AuthorizedResponse = Response<unknown, { user: ResolvedUser }>

/** Exige un único header sin ambigüedad y obtiene rol/estado exclusivamente desde UserService. */
export function authorizeRoles(...roles: UserRole[]) {
  return async (request: Request, response: AuthorizedResponse, next: NextFunction): Promise<void> => {
    try {
      const headers = request.rawHeaders.filter((header, index) => index % 2 === 0 && header.toLowerCase() === 'x-cibernova-user-id')
      if (headers.length === 0) throw new UserError(401, 'IDENTITY_REQUIRED', 'Selecciona una identidad para realizar esta operación.')
      const userId = request.headers['x-cibernova-user-id']
      if (headers.length !== 1 || typeof userId !== 'string') throw new UserError(400, 'INVALID_USER_ID', 'El header de identidad no es válido.')
      const user = await userService.resolve(userId)
      if (!roles.includes(user.role)) throw new UserError(403, 'FORBIDDEN', 'Esta identidad no tiene permiso para realizar la operación.')
      response.locals.user = user
      next()
    } catch (error) { next(error) }
  }
}
