/** CN-67: consulta administrativa Read-Only con app, RBAC, ProductService, Pricing e Inventory reales sobre Algolia simulado. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { QA_ALGOLIA_ENV, QA_PRODUCTS, QA_USERS, createFakeAlgoliaCatalog } from './helpers/fakeAlgoliaCatalog.mjs'

Object.assign(process.env, QA_ALGOLIA_ENV)
const { default: app } = await import('../dist/app.js')
const { getAlgoliaClient } = await import('../dist/config/algolia.js')
const { userService } = await import('../dist/services/userService.js')
const { toAdminProduct } = await import('../dist/mappers/adminProductMapper.js')
const { parseAdminProductQuery } = await import('../dist/services/adminProductService.js')
const { ROLE_PERMISSIONS } = await import('../dist/domain/orderAccess.js')

const sku = id => 'QA-' + id.slice(3).toUpperCase()
// Producto con inventario inconsistente para comprobar que se informa sin corregir el dataset.
const inconsistent = { ...QA_PRODUCTS[0], objectID: 'qa-inconsistent', title: 'Disco con inventario inconsistente', stock_quantity: 99,
  in_stock: false, stock_by_branch: { san_jose: 1, alajuela: 'x', cartago: 0, heredia: 2 } }
const products = [...QA_PRODUCTS, inconsistent].map(record => ({ ...record, sku: sku(record.objectID), currency: 'CRC' }))
const admin = 'qa-admin'

async function setup(t) {
  const catalog = createFakeAlgoliaCatalog(products)
  const algolia = getAlgoliaClient()
  t.mock.method(algolia, 'searchSingleIndex', catalog.searchSingleIndex)
  t.mock.method(algolia, 'getObject', catalog.getObject)
  t.mock.method(userService.directory, 'find', async id => QA_USERS.find(record => record.objectID === id))
  t.mock.method(userService.directory, 'list', async () => QA_USERS)
  const server = app.listen(0, '127.0.0.1')
  await new Promise(resolve => server.once('listening', resolve))
  t.after(() => new Promise(resolve => server.close(resolve)))
  const base = 'http://127.0.0.1:' + server.address().port + '/api/v2/admin/products'
  const get = async (path = '', userId = admin, init = {}) => {
    const response = await fetch(base + path, { ...init, headers: { ...(userId ? { 'X-CiberNova-User-Id': userId } : {}), ...init.headers } })
    return { status: response.status, body: await response.json().catch(() => null) }
  }
  return { catalog, get }
}

test('RBAC: solo ADMIN obtiene catalog:read:admin y accede a los endpoints', async t => {
  assert.ok(ROLE_PERMISSIONS.ADMIN.includes('catalog:read:admin'))
  assert.ok(!ROLE_PERMISSIONS.B2C.includes('catalog:read:admin') && !ROLE_PERMISSIONS.B2B.includes('catalog:read:admin'))
  const { get, catalog } = await setup(t)
  assert.equal((await get()).status, 200)
  for (const [userId, status, code] of [
    ['qa-b2c', 403, 'FORBIDDEN'], ['qa-b2b', 403, 'FORBIDDEN'], [null, 401, 'IDENTITY_REQUIRED'],
    ['qa-missing', 404, 'USER_NOT_FOUND'], ['qa-disabled', 403, 'USER_DISABLED'],
  ]) {
    for (const path of ['', '/qa-ssd-1tb']) {
      const response = await get(path, userId)
      assert.equal(response.status, status, `${userId} ${path}`)
      assert.equal(response.body.error.code, code)
    }
  }
  // Los rechazos ocurren antes de consultar el catálogo.
  assert.equal(catalog.calls.length, 1)
})

test('detalle: precios Retail/Wholesale, MOQ, B2B y las cuatro sucursales sin usar stock global', async t => {
  const { get } = await setup(t)
  const { status, body } = await get('/qa-ssd-1tb')
  assert.equal(status, 200)
  assert.deepEqual(body, {
    id: 'qa-ssd-1tb', sku: 'QA-SSD-1TB', title: 'SSD NVMe 1 TB', brand: 'Kingston', categories: ['Almacenamiento', 'SSD'], image: null, currency: 'CRC',
    pricing: { retailPrice: 45000, wholesalePrice: 39000, b2bAvailable: true, minOrderQuantity: 3, b2bStatus: 'eligible' },
    inventory: { globalStock: 30, branchTotal: 30, availability: 'limited', insufficientForMoq: false, branches: [
      { branchId: 'san_jose', name: 'San José', quantity: 20, status: 'available' },
      { branchId: 'alajuela', name: 'Alajuela', quantity: 2, status: 'below-moq' },
      { branchId: 'cartago', name: 'Cartago', quantity: 0, status: 'out-of-stock' },
      { branchId: 'heredia', name: 'Heredia', quantity: 8, status: 'available' },
    ] },
    issues: [],
  })
  for (const forbidden of ['objectID', '_highlightResult', 'facets', 'description', 'discount_tiers', 'stock_by_branch']) {
    assert.ok(!JSON.stringify(body).includes(forbidden), forbidden)
  }
  assert.equal((await get('/no-existe')).body.error.code, 'PRODUCT_NOT_FOUND')
  assert.equal((await get('/no-existe')).status, 404)
})

test('estados: agotado, MOQ insuficiente, B2B no disponible e inconsistencias informadas sin corregir', () => {
  const byId = id => toAdminProduct(products.find(record => record.objectID === id))
  const router = byId('qa-router')
  assert.equal(router.inventory.availability, 'out-of-stock')
  assert.ok(router.inventory.branches.every(branch => branch.status === 'out-of-stock' && branch.quantity === 0))
  assert.equal(router.inventory.insufficientForMoq, false)

  const headset = byId('qa-headset')
  assert.equal(headset.inventory.branches.find(branch => branch.branchId === 'alajuela').status, 'below-moq')
  assert.equal(headset.inventory.availability, 'available')

  const mouse = byId('qa-mouse')
  assert.deepEqual(mouse.pricing, { retailPrice: 12500, wholesalePrice: null, b2bAvailable: false, minOrderQuantity: null, b2bStatus: 'not-available' })
  // Sin elegibilidad B2B el MOQ no condiciona la disponibilidad por sucursal.
  assert.ok(mouse.inventory.branches.every(branch => branch.status === 'available'))

  const notEligibleWithPrice = toAdminProduct({ ...products[0], b2b: { available: false, wholesale_price: 39000, min_order_quantity: 3 } })
  assert.deepEqual(notEligibleWithPrice.pricing, { retailPrice: 45000, wholesalePrice: 39000, b2bAvailable: false, minOrderQuantity: 3, b2bStatus: 'not-available' })

  const belowEverywhere = toAdminProduct({ ...products[0], b2b: { available: true, wholesale_price: 1, min_order_quantity: 50 } })
  assert.equal(belowEverywhere.inventory.insufficientForMoq, true)
  assert.ok(belowEverywhere.inventory.branches.filter(branch => branch.quantity > 0).every(branch => branch.status === 'below-moq'))

  const invalidB2B = toAdminProduct({ ...products[0], b2b: { available: true, wholesale_price: -1, min_order_quantity: 0 } })
  assert.equal(invalidB2B.pricing.b2bStatus, 'invalid')
  assert.deepEqual(invalidB2B.issues, ['B2B_DATA_INVALID'])

  const broken = byId('qa-inconsistent')
  assert.equal(broken.inventory.globalStock, 99)
  assert.equal(broken.inventory.branchTotal, null)
  assert.equal(broken.inventory.availability, 'invalid')
  assert.deepEqual(broken.inventory.branches.map(branch => [branch.quantity, branch.status]), [[1, 'below-moq'], [null, 'invalid'], [0, 'out-of-stock'], [2, 'below-moq']])
  assert.deepEqual(broken.issues, ['BRANCH_INVENTORY_INVALID'])
  const mismatch = toAdminProduct({ ...products[0], stock_quantity: 31, in_stock: false })
  assert.deepEqual(mismatch.issues, ['STOCK_TOTAL_MISMATCH', 'IN_STOCK_FLAG_MISMATCH'])
  assert.equal(mismatch.inventory.globalStock, 31)
  assert.equal(mismatch.inventory.branchTotal, 30)
  assert.equal(products.find(record => record.objectID === 'qa-inconsistent').stock_quantity, 99)
})

test('búsqueda por título y SKU, filtros de catálogo, sucursal, disponibilidad y B2B', async t => {
  const { get } = await setup(t)
  const ids = async query => (await get('?' + query)).body.products.map(product => product.id)
  assert.deepEqual(await ids('q=monitor'), ['qa-monitor-27'])
  assert.deepEqual(await ids('q=QA-RAM-32'), ['qa-ram-32'])
  assert.deepEqual(await ids('categories=Perif%C3%A9ricos&sort=title'), ['qa-headset', 'qa-mouse', 'qa-keyboard'])
  assert.deepEqual(await ids('brands=Logitech&brands=Dell'), ['qa-monitor-27', 'qa-mouse', 'qa-keyboard'])
  assert.deepEqual(await ids('availability=out-of-stock'), ['qa-router'])
  assert.deepEqual(await ids('branchId=cartago&availability=out-of-stock'), ['qa-ssd-1tb', 'qa-laptop-14', 'qa-router', 'qa-inconsistent'])
  assert.deepEqual(await ids('branchId=alajuela&availability=below-moq'), ['qa-ssd-1tb', 'qa-headset'])
  assert.deepEqual(await ids('branchId=heredia&availability=available&b2b=eligible&sort=stock_desc'), ['qa-ram-32', 'qa-headset', 'qa-ssd-1tb', 'qa-keyboard', 'qa-laptop-14'])
  assert.deepEqual(await ids('b2b=not-available'), ['qa-mouse'])
  assert.deepEqual(await ids('availability=invalid'), ['qa-inconsistent'])
  assert.deepEqual(await ids('sort=retail_desc&pageSize=2'), ['qa-laptop-14', 'qa-monitor-27'])

  const { body } = await get('?q=monitor')
  assert.deepEqual(body.facets.brands, { Dell: 1 })
  assert.equal(body.total, 1)
})

test('paginación consistente y filtros inválidos rechazados', async t => {
  const { get } = await setup(t)
  const first = (await get('?pageSize=4&sort=title')).body
  const third = (await get('?pageSize=4&sort=title&page=3')).body
  assert.deepEqual([first.page, first.pageSize, first.total, first.totalPages, first.products.length], [1, 4, 9, 3, 4])
  assert.deepEqual([third.page, third.products.length], [3, 1])
  const seen = new Set()
  for (let page = 1; page <= 3; page++) for (const product of (await get(`?pageSize=4&sort=title&page=${page}`)).body.products) seen.add(product.id)
  assert.equal(seen.size, 9)
  assert.equal((await get('?pageSize=4&page=99')).body.page, 3)
  for (const [query, code] of [
    ['branchId=limon', 'INVALID_BRANCH_ID'], ['availability=soon', 'INVALID_PRODUCT_FILTER'], ['branchId=cartago&availability=limited', 'INVALID_PRODUCT_FILTER'],
    ['b2b=yes', 'INVALID_PRODUCT_FILTER'], ['sort=price', 'INVALID_PRODUCT_FILTER'], ['page=0', 'INVALID_PRODUCT_FILTER'],
    ['pageSize=49', 'INVALID_PRODUCT_FILTER'], ['page=1&page=2', 'INVALID_PRODUCT_FILTER'], ['q=' + 'x'.repeat(121), 'INVALID_PRODUCT_FILTER'],
  ]) {
    const response = await get('?' + query)
    assert.equal(response.status, 400, query)
    assert.equal(response.body.error.code, code, query)
  }
  assert.deepEqual(parseAdminProductQuery({}), { q: '', branchId: null, availability: null, categories: [], brands: [], b2b: null, sort: 'relevance', page: 1, pageSize: 12 })
})

test('Read-Only: solo lecturas a Algolia, sin métodos de escritura y errores sin detalles internos', async t => {
  const { get, catalog } = await setup(t)
  await get('?q=QA-SSD-1TB&branchId=san_jose')
  await get('/qa-monitor-27')
  assert.ok(catalog.calls.length > 0)
  assert.ok(catalog.calls.every(call => call.type === 'search' || call.type === 'getObject'))
  assert.ok(catalog.calls.every(call => call.indexName === QA_ALGOLIA_ENV.ALGOLIA_INDEX_NAME))
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    const response = await get('/qa-monitor-27', admin, { method })
    assert.equal(response.status, 404, method)
  }
  t.mock.method(getAlgoliaClient(), 'searchSingleIndex', async () => { throw new Error('PRIVATE algolia key and host') })
  const failure = await get()
  assert.equal(failure.status, 503)
  assert.equal(failure.body.error.code, 'CATALOG_UNAVAILABLE')
  assert.ok(!JSON.stringify(failure.body).includes('PRIVATE'))
})

test('compatibilidad: el catálogo público B2C/B2B conserva sus contratos', async t => {
  const { catalog } = await setup(t)
  const server = app.listen(0, '127.0.0.1')
  await new Promise(resolve => server.once('listening', resolve))
  t.after(() => new Promise(resolve => server.close(resolve)))
  const base = 'http://127.0.0.1:' + server.address().port + '/api/products'
  const retail = await (await fetch(base + '?perPage=3')).json()
  assert.equal(retail.products.length, 3)
  assert.equal(retail.products[0].pricing.type, 'RETAIL')
  const wholesale = await (await fetch(base + '?perPage=50&sort=price_asc', { headers: { 'X-CiberNova-User-Id': 'qa-b2b' } })).json()
  assert.equal(wholesale.products[0].pricing.type, 'WHOLESALE')
  assert.equal(wholesale.totalProducts, products.length)
  assert.ok(!('inventory' in wholesale.products[0]) || !('branches' in wholesale.products[0].inventory))
  assert.ok(catalog.calls.length >= 2)
})
