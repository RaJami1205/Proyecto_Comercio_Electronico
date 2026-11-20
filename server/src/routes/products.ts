/** Asocia endpoints GET del catálogo, Search y categorías con sus controllers. */
import { Router } from 'express'

import {
  getProducts,
  searchProductCatalog,
} from '../controllers/productController.js'

import { getCategoryTreeHandler } from '../controllers/productController.js'
import { resolveOptionalIdentity } from '../middleware/authorization.js'



const productsRouter = Router()

productsRouter.get('/search', resolveOptionalIdentity(), searchProductCatalog)
productsRouter.get('/', resolveOptionalIdentity(), getProducts)

productsRouter.get('/categories/tree', getCategoryTreeHandler)

export default productsRouter
