/** Endpoint público de consulta de las sucursales habilitadas. */
import { Router } from 'express'
import { listBranches } from '../controllers/branchController.js'

const branchesRouter = Router()
branchesRouter.get('/', listBranches)
export default branchesRouter
