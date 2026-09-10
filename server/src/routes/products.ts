import { Router } from 'express'

import {
  getProducts,
  searchProductCatalog,
} from '../controllers/productController.js'

import { debugTaxonomy } from '../controllers/debugController.js'

import { getCategoryTreeHandler } from '../controllers/productController.js'



const productsRouter = Router()

productsRouter.get('/search', searchProductCatalog)
productsRouter.get('/', getProducts)

productsRouter.get('/debug/taxonomy', debugTaxonomy)

productsRouter.get('/categories/tree', getCategoryTreeHandler)

export default productsRouter
