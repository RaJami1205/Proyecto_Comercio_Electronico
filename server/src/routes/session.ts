/** Asocia la resolución de identidad simulada con su controlador. */
import { Router } from 'express'
import { resolveSession } from '../controllers/userController.js'

const sessionRouter = Router()
sessionRouter.post('/resolve', resolveSession)
export default sessionRouter
