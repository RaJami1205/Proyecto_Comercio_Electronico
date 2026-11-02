/** Asocia la consulta de identidades simuladas con su controlador. */
import { Router } from 'express'
import { listUsers } from '../controllers/userController.js'

const usersRouter = Router()
usersRouter.get('/', listUsers)
export default usersRouter
