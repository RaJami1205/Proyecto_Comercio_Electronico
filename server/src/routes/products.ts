import { Router } from 'express'

import {
  getProducts,
  searchProductCatalog,
} from '../controllers/productController.js'

const productsRouter = Router()

productsRouter.get('/search', searchProductCatalog)
productsRouter.get('/', getProducts)

export default productsRouter
