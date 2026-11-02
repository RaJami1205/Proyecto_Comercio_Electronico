/** Conecta las solicitudes HTTP de identidades simuladas con UserService, sin crear tokens ni sesiones. */
import type { NextFunction, Request, Response } from 'express'
import { userService } from '../services/userService.js'

/** Responde con las identidades que el futuro Simulated Login puede ofrecer. */
export async function listUsers(_request: Request, response: Response, next: NextFunction): Promise<void> {
  try { response.status(200).json({ users: await userService.listSelectable() }) }
  catch (error) { next(error) }
}

/** Lee únicamente userId del cuerpo y responde con el perfil validado por Server. */
export async function resolveSession(request: Request, response: Response, next: NextFunction): Promise<void> {
  try {
    const body: unknown = request.body
    const userId = typeof body === 'object' && body !== null && 'userId' in body ? body.userId : undefined
    response.status(200).json({ user: await userService.resolve(userId) })
  } catch (error) { next(error) }
}
