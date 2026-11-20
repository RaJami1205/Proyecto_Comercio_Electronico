/** CN-67: consulta administrativa Read-Only con app, RBAC, ProductService, Pricing e Inventory reales sobre Algolia simulado. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { QA_ALGOLIA_ENV, QA_PRODUCTS, QA_USERS, createFakeAlgoliaCatalog } from './helpers/fakeAlgoliaCatalog.mjs'

Object.assign(process.env, QA_ALGOLIA_ENV)
const { default: app } = await import('../dist/app.js')
const { getAlgoliaClient } = await import('../dist/config/algolia.js')
const { userService } = await import('../dist/services/userService.js')
const { toAdminProduct } = await import('../dist/mappers/adminProductMapper.js')
const { resolvePricing } = await import('../dist/domain/pricing.js')
const { parseAdminProductQuery } = await import('../dist/services/adminProductService.js')
const { ROLE_PERMISSIONS } = await import('../dist/domain/orderAccess.js')

const sku = id => 'QA-' + id.slice(3).toUpperCase()
// Producto con inventario inconsistente para comprobar que se informa sin corregir el dataset.
const inconsistent = { ...QA_PRODUCTS[0], objectID: 'qa-inconsistent', title: 'Disco con inventario inconsistente', stock_quantity: 99,
  in_stock: false, stock_by_branch: { san_jose: 1, alajuela: 'x', cartago: 0, heredia: 2 } }
const products = [...QA_PRODUCTS, inconsistent].map(record => ({ ...record, sku: sku(record.objectID), currency: 'CRC' }))
const admin = 'qa-admin'

async function setup(t, records = products) {
  const catalog = createFakeAlgoliaCatalog(records)
  const algolia = getAlgoliaClient()
  t.mock.method(algolia, 'searchSingleIndex', catalog.searchSingleIndex)
  t.mock.method(algolia, 'getObject', catalog.getObject)
  t.mock.method(userService.directory, 'find', async id => QA_USERS.find(record => record.objectID === id))
  t.mock.method(userService.directory, 'list', async () => QA_USERS)
  const server = app.listen(0, '127.0.0.1')
  await new Promise(resolve => server.once('listening', resolve))
  t.after(() => new Promise(resolve => server.close(resolve)))
  const origin = 'http://127.0.0.1:' + server.address().port
  const base = origin + '/api/v2/admin/products'
  const get = async (path = '', userId = admin, init = {}) => {
    const response = await fetch(base + path, { ...init, headers: { ...(userId ? { 'X-CiberNova-User-Id': userId } : {}), ...init.headers } })
    return { status: response.status, body: await response.json().catch(() => null) }
  }
  return { catalog, get, origin }
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
  assert.equal(broken.inventory.insufficientForMoq, false)
  assert.deepEqual(broken.inventory.branches.map(branch => [branch.quantity, branch.status]), [[1, 'below-moq'], [null, 'invalid'], [0, 'out-of-stock'], [2, 'below-moq']])
  assert.deepEqual(broken.issues, ['BRANCH_INVENTORY_INVALID'])
  const mismatch = toAdminProduct({ ...products[0], stock_quantity: 31, in_stock: false })
  assert.deepEqual(mismatch.issues, ['STOCK_TOTAL_MISMATCH', 'IN_STOCK_FLAG_MISMATCH'])
  assert.equal(mismatch.inventory.globalStock, 31)
  assert.equal(mismatch.inventory.branchTotal, 30)
  assert.equal(products.find(record => record.objectID === 'qa-inconsistent').stock_quantity, 99)
})

test('MOQ global requiere cuatro cantidades válidas y conserva los estados individuales', async t => {
  const branchIds = ['san_jose', 'alajuela', 'cartago', 'heredia']
  const below = [[1, 'below-moq'], [2, 'below-moq'], [0, 'out-of-stock'], [2, 'below-moq']]
  const noMoq = [[1, 'available'], [2, 'available'], [0, 'out-of-stock'], [2, 'available']]
  for (const [name, quantities, moq, eligible, insufficient, availability, expectedBranches] of [
    ['conocidas por debajo del MOQ', [1, 2, 0, 2], 3, true, true, 'limited', below],
    ['una sucursal alcanza exactamente MOQ', [1, 3, 0, 2], 3, true, false, 'limited',
      [[1, 'below-moq'], [3, 'available'], [0, 'out-of-stock'], [2, 'below-moq']]],
    ['una cantidad null', [1, null, 0, 2], 3, true, false, 'invalid',
      [[1, 'below-moq'], [null, 'invalid'], [0, 'out-of-stock'], [2, 'below-moq']]],
    ['una sucursal ausente', [1, undefined, 0, 2], 3, true, false, 'invalid',
      [[1, 'below-moq'], [null, 'invalid'], [0, 'out-of-stock'], [2, 'below-moq']]],
    ['varias cantidades desconocidas', [null, undefined, 0, 2], 3, true, false, 'invalid',
      [[null, 'invalid'], [null, 'invalid'], [0, 'out-of-stock'], [2, 'below-moq']]],
    ['una cantidad no numérica', [1, 'x', 0, 2], 3, true, false, 'invalid',
      [[1, 'below-moq'], [null, 'invalid'], [0, 'out-of-stock'], [2, 'below-moq']]],
    ['una cantidad negativa', [1, -1, 0, 2], 3, true, false, 'invalid',
      [[1, 'below-moq'], [null, 'invalid'], [0, 'out-of-stock'], [2, 'below-moq']]],
    ['todas las sucursales agotadas', [0, 0, 0, 0], 3, true, false, 'out-of-stock',
      [[0, 'out-of-stock'], [0, 'out-of-stock'], [0, 'out-of-stock'], [0, 'out-of-stock']]],
    ['todas las sucursales satisfacen MOQ', [3, 4, 5, 6], 3, true, false, 'available',
      [[3, 'available'], [4, 'available'], [5, 'available'], [6, 'available']]],
    ['MOQ inválido', [1, 2, 0, 2], 0, true, false, 'limited', noMoq],
    ['MOQ ausente', [1, 2, 0, 2], undefined, true, false, 'limited', noMoq],
    ['producto B2B no elegible', [1, 2, 0, 2], 3, false, false, 'limited', noMoq],
    ['inventario por sucursal ausente', undefined, 3, true, false, 'invalid',
      [[null, 'invalid'], [null, 'invalid'], [null, 'invalid'], [null, 'invalid']]],
    ['cantidad desconocida y otra suficiente', [3, null, 0, 2], 3, true, false, 'invalid',
      [[3, 'available'], [null, 'invalid'], [0, 'out-of-stock'], [2, 'below-moq']]],
  ]) {
    await t.test(name, () => {
      const record = { ...products[0], stock_quantity: 99,
        b2b: { available: eligible, wholesale_price: 39000, min_order_quantity: moq },
        stock_by_branch: quantities === undefined ? undefined
          : Object.fromEntries(branchIds.flatMap((id, index) => quantities[index] === undefined ? [] : [[id, quantities[index]]])),
      }
      const original = structuredClone(record)
      const result = toAdminProduct(record)
      assert.equal(result.inventory.insufficientForMoq, insufficient)
      assert.equal(result.inventory.availability, availability)
      assert.deepEqual(result.inventory.branches.map(branch => branch.branchId), branchIds)
      assert.deepEqual(result.inventory.branches.map(branch => [branch.quantity, branch.status]), expectedBranches)
      assert.equal(result.issues.includes('BRANCH_INVENTORY_INVALID'), availability === 'invalid')
      assert.equal(result.inventory.branchTotal === null, availability === 'invalid')
      // El stock global no reemplaza cantidades desconocidas ni se corrige durante el mapping.
      assert.equal(result.inventory.globalStock, 99)
      assert.deepEqual(record, original)
    })
  }
})

test('detalle y filtro MOQ conservan el inventario desconocido y distinguen insuficiencia comprobada', async t => {
  const confirmed = { ...products[0], objectID: 'qa-confirmed-below', stock_quantity: 5,
    stock_by_branch: { san_jose: 1, alajuela: 2, cartago: 0, heredia: 2 } }
  const { get } = await setup(t, [products.find(record => record.objectID === 'qa-inconsistent'), confirmed])
  const detail = await get('/qa-inconsistent')
  assert.equal(detail.status, 200)
  assert.equal(detail.body.inventory.insufficientForMoq, false)
  assert.equal(detail.body.inventory.branches[1].quantity, null)
  assert.equal(detail.body.inventory.branches[1].status, 'invalid')
  assert.ok(detail.body.issues.includes('BRANCH_INVENTORY_INVALID'))
  const insufficient = await get('?availability=below-moq')
  assert.equal(insufficient.status, 200)
  assert.deepEqual(insufficient.body.products.map(product => product.id), ['qa-confirmed-below'])
  const invalid = await get('?availability=invalid')
  assert.equal(invalid.status, 200)
  assert.deepEqual(invalid.body.products.map(product => product.id), ['qa-inconsistent'])
})

const b2bConditions = available => ({ available, wholesale_price: 39000, min_order_quantity: 3 })
const b2bCases = [
  ['true booleano', b2bConditions(true), true, 'eligible', 39000, 3],
  ['false booleano', b2bConditions(false), false, 'not-available', 39000, 3],
  ['false sin precio ni MOQ', { available: false }, false, 'not-available', null, null],
  ['string true', b2bConditions('true'), null, 'invalid', 39000, 3],
  ['string false', b2bConditions('false'), null, 'invalid', 39000, 3],
  ['available null', b2bConditions(null), null, 'invalid', 39000, 3],
  ['available ausente', { wholesale_price: 39000, min_order_quantity: 3 }, null, 'invalid', 39000, 3],
  ['available 1', b2bConditions(1), null, 'invalid', 39000, 3],
  ['available 0', b2bConditions(0), null, 'invalid', 39000, 3],
  ['available objeto', b2bConditions({ value: true }), null, 'invalid', 39000, 3],
  ['available array', b2bConditions([]), null, 'invalid', 39000, 3],
  ['Wholesale inválido', { ...b2bConditions(true), wholesale_price: -1 }, true, 'invalid', null, 3],
  ['MOQ inválido', { ...b2bConditions(true), min_order_quantity: 0 }, true, 'invalid', 39000, null],
  ['MOQ ausente', { available: true, wholesale_price: 39000 }, true, 'invalid', 39000, null],
  ['estructura B2B ausente', undefined, null, 'invalid', null, null],
  ['estructura B2B null', null, null, 'invalid', null, null],
  ['estructura B2B array', [], null, 'invalid', null, null],
]

test('clasificación administrativa B2B distingue booleanos legítimos de datos inválidos sin coerción', async t => {
  for (const [name, conditions, available, status, price, moq] of b2bCases) {
    await t.test(name, () => {
      const record = { ...products[0], b2b: conditions }
      const original = structuredClone(record)
      const commercial = resolvePricing(record, 'B2B')
      const result = toAdminProduct(record)
      assert.deepEqual(result.pricing, { retailPrice: 45000, wholesalePrice: price, b2bAvailable: available,
        minOrderQuantity: moq, b2bStatus: status })
      assert.equal(result.issues.includes('B2B_DATA_INVALID'), status === 'invalid')
      assert.equal(commercial.eligible, status === 'eligible')
      assert.deepEqual(resolvePricing(record, 'B2B'), commercial)
      assert.deepEqual(result.inventory.branches.map(branch => branch.quantity), [20, 2, 0, 8])
      assert.equal(result.inventory.insufficientForMoq, false)
      assert.deepEqual(record, original)
    })
  }
})

test('filtros y detalle B2B recuperan datos inválidos sin confundirlos con deshabilitación legítima', async t => {
  const records = b2bCases.map(([, conditions], index) => ({ ...products[0], objectID: `b2b-case-${index}`, b2b: conditions }))
  const { get } = await setup(t, records)
  for (const status of ['eligible', 'not-available', 'invalid']) {
    const response = await get(`?b2b=${status}&pageSize=48`)
    const expected = records.filter((record, index) => b2bCases[index][3] === status)
    assert.equal(response.status, 200)
    assert.equal(response.body.total, expected.length)
    assert.deepEqual(response.body.products.map(product => product.id), expected.map(record => record.objectID))
    assert.equal(response.body.facets.brands.Kingston, expected.length)
    assert.ok(response.body.products.every(product => product.issues.includes('B2B_DATA_INVALID') === (status === 'invalid')))
  }
  for (const name of ['string true', 'false booleano']) {
    const index = b2bCases.findIndex(([label]) => label === name)
    const response = await get(`/b2b-case-${index}`)
    assert.equal(response.status, 200)
    assert.equal(response.body.pricing.b2bAvailable, b2bCases[index][2])
    assert.equal(response.body.pricing.b2bStatus, b2bCases[index][3])
    assert.equal(response.body.pricing.wholesalePrice, 39000)
    assert.equal(response.body.pricing.minOrderQuantity, 3)
    assert.equal(response.body.issues.includes('B2B_DATA_INVALID'), name === 'string true')
  }
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

const skuCases = [
  ['convencional', 'sku-standard', 'SAM-DIS-0214'],
  ['con punto', 'sku-dot', 'G.S-MEM-0118'],
  ['con espacio interno', 'sku-space', 'ACME OFFICE 0001'],
  ['con doble guion', 'sku-double', 'TP--HUB-0263'],
  ['con espacio junto al guion', 'sku-space-hyphen', 'EXT-PC -0060'],
]
const skuProducts = skuCases.map(([, objectID, sku], index) => ({
  ...QA_PRODUCTS[0], objectID, sku, title: `Artículo de prueba ${index}`, brand: 'MarcaSKU',
}))

test('SKU exacto: formatos reales aunque Algolia no busque el atributo sku', async t => {
  const { get, catalog } = await setup(t, skuProducts)
  for (const [name, id, sku] of skuCases) {
    await t.test(name, async () => {
      // El doble busca exclusivamente title/brand/categories: ninguna consulta exacta encuentra el SKU por sí sola.
      const original = await catalog.searchSingleIndex({ indexName: QA_ALGOLIA_ENV.ALGOLIA_INDEX_NAME, searchParams: { query: sku } })
      assert.deepEqual(original.hits, [])
      const start = catalog.calls.length
      const response = await get('?' + new URLSearchParams({ q: sku }))
      assert.equal(response.status, 200)
      assert.equal(response.body.total, 1)
      assert.deepEqual(response.body.products.map(product => [product.id, product.sku]), [[id, sku]])
      assert.deepEqual(response.body.facets, { categories: { Almacenamiento: 1, SSD: 1 }, brands: { MarcaSKU: 1 } })
      assert.deepEqual(catalog.calls.slice(start).map(call => call.searchParams.query), [sku, ''])
    })
  }
})

test('SKU parcial: comparación literal sin eliminar puntos, espacios ni guiones', async t => {
  const { get } = await setup(t, skuProducts)
  for (const [q, expected] of [
    ['DIS-021', ['sku-standard']], ['g.s-mem', ['sku-dot']], ['office 00', ['sku-space']],
    ['--hub', ['sku-double']], ['PC -00', ['sku-space-hyphen']], ['  g.s-mem-0118  ', ['sku-dot']],
    ['GSMEM0118', []], ['TP-HUB-0263', []], ['EXT-PC-0060', []], ['.*', []], ['SKU-DOES-NOT-EXIST', []],
  ]) {
    await t.test(q, async () => {
      const response = await get('?' + new URLSearchParams({ q }))
      assert.equal(response.status, 200)
      assert.deepEqual(response.body.products.map(product => product.id), expected)
      assert.deepEqual(response.body.facets, expected.length
        ? { categories: { Almacenamiento: 1, SSD: 1 }, brands: { MarcaSKU: 1 } }
        : { categories: {}, brands: {} })
    })
  }
  assert.deepEqual(skuProducts.map(product => product.sku), skuCases.map(([, , sku]) => sku))
})

test('SKU complementa Title y Brand, combina coincidencias sin duplicados y omite el recorrido adicional si q está vacío', async t => {
  const records = [
    { ...skuProducts[0], title: 'Disco especial para pruebas', brand: 'MarcaTexto' },
    { ...skuProducts[1], title: 'Texto mixto MIX', sku: 'MIX.0118' },
    { ...skuProducts[2], sku: 'MIX--0001' },
  ]
  const { get, catalog } = await setup(t, records)
  for (const [q, expected] of [
    ['Disco especial', ['sku-standard']], ['MarcaTexto', ['sku-standard']], ['MIX', ['sku-dot', 'sku-space']],
  ]) {
    const response = await get('?' + new URLSearchParams({ q }))
    assert.equal(response.status, 200)
    assert.deepEqual(response.body.products.map(product => product.id), expected)
    assert.equal(response.body.total, expected.length)
    assert.equal(new Set(response.body.products.map(product => product.id)).size, expected.length)
  }
  const start = catalog.calls.length
  assert.equal((await get()).body.total, records.length)
  assert.deepEqual(catalog.calls.slice(start).map(call => call.searchParams.query), [''])
})

test('SKU conserva filtros y aplica orden y paginación después de combinar resultados', async t => {
  const { get, catalog } = await setup(t)
  const response = await get('?' + new URLSearchParams({ q: 'QA', categories: 'Periféricos', brands: 'Logitech',
    branchId: 'san_jose', availability: 'below-moq', b2b: 'eligible' }))
  assert.equal(response.status, 200)
  assert.deepEqual(response.body.products.map(product => product.id), ['qa-keyboard'])
  assert.ok(catalog.calls.every(call => JSON.stringify(call.searchParams.facetFilters) === JSON.stringify([
    ['categories:Periféricos'], ['brand:Logitech'],
  ])))
  const seen = []
  for (let page = 1; page <= 3; page++) {
    const { status, body } = await get(`?q=QA&sort=title&pageSize=4&page=${page}`)
    assert.equal(status, 200)
    assert.deepEqual([body.page, body.total, body.totalPages], [page, products.length, 3])
    seen.push(...body.products.map(product => product.id))
  }
  assert.equal(new Set(seen).size, products.length)
  assert.deepEqual([...seen].sort(), products.map(product => product.objectID).sort())
})

test('SKU recupera una coincidencia fuera de la primera página del catálogo', async t => {
  const records = Array.from({ length: 1001 }, (_, index) => ({ ...QA_PRODUCTS[0], objectID: `sku-page-${index}`,
    title: `Artículo ${index}`, sku: index === 1000 ? 'G.S-LATE-1000' : `FILL-${index}` }))
  const { get, catalog } = await setup(t, records)
  const response = await get('?q=G.S-LATE-1000&pageSize=1')
  assert.equal(response.status, 200)
  assert.deepEqual(response.body.products.map(product => product.id), ['sku-page-1000'])
  assert.equal(response.body.total, 1)
  assert.deepEqual(response.body.facets, { categories: { Almacenamiento: 1, SSD: 1 }, brands: { Kingston: 1 } })
  assert.deepEqual(catalog.calls.filter(call => call.searchParams.query === '').map(call => call.searchParams.page), [0, 1])
})

test('SKU propaga las guardas existentes de catálogo limitado, página incompleta y fallo del complemento', async t => {
  for (const mode of ['limited', 'incomplete', 'unavailable']) {
    await t.test(mode, async child => {
      const records = Array.from({ length: 1001 }, (_, index) => ({ ...QA_PRODUCTS[0], objectID: `sku-page-${index}`,
        title: index === 0 ? 'MIX texto' : `Artículo ${index}`, sku: index === 1000 ? 'MIX.1000' : `FILL-${index}` }))
      const { get, catalog } = await setup(child, records)
      child.mock.method(getAlgoliaClient(), 'searchSingleIndex', async input => {
        const response = await catalog.searchSingleIndex(input)
        if (input.searchParams.query !== '') return response
        if (mode === 'unavailable') throw new Error('PRIVATE upstream detail')
        if (mode === 'limited') return { ...response, nbPages: 1 }
        return input.searchParams.page === 1 ? { ...response, hits: [] } : response
      })
      const response = await get('?q=MIX')
      assert.equal(response.status, 503)
      assert.equal(response.body.error.code, mode === 'unavailable' ? 'CATALOG_UNAVAILABLE' : 'CATALOG_RESULT_LIMIT')
      assert.equal('products' in response.body, false)
      assert.ok(!JSON.stringify(response.body).includes('PRIVATE'))
    })
  }
})

test('facets de texto y SKU: unión completa sin duplicar productos, categorías ni conteos entre páginas', async t => {
  const records = [
    { ...QA_PRODUCTS[0], objectID: 'facet-text', title: 'MATCH texto', sku: 'OTHER-0001',
      brand: 'Marca Texto', categories: ['SoloTexto', 'Compartida'] },
    { ...QA_PRODUCTS[0], objectID: 'facet-both', title: 'MATCH compartido', sku: 'MATCH.0002',
      brand: 'Marca Compartida', categories: ['Compartida', 'Otra', 'Otra'] },
    { ...QA_PRODUCTS[0], objectID: 'facet-sku', title: 'Elemento independiente', sku: 'MATCH--0003',
      brand: 'Marca SKU', categories: ['SoloSKU', 'Compartida'] },
    { ...QA_PRODUCTS[0], objectID: 'facet-excluded', title: 'Producto ajeno', sku: 'NO-0004',
      brand: 'Marca Ajena', categories: ['Ajena'] },
  ]
  const { get, catalog } = await setup(t, records)
  t.mock.method(getAlgoliaClient(), 'searchSingleIndex', async input => {
    const response = await catalog.searchSingleIndex(input)
    // Conteos controlados de la búsqueda textual: no incluyen la coincidencia exclusiva por SKU.
    return input.searchParams.query === 'MATCH' ? { ...response, facets: {
      categories: { SoloTexto: 1, Compartida: 2, Otra: 1 }, brand: { 'Marca Texto': 1, 'Marca Compartida': 1 },
    } } : response
  })
  const expectedFacets = { categories: { SoloTexto: 1, Compartida: 3, Otra: 1, SoloSKU: 1 },
    brands: { 'Marca Texto': 1, 'Marca Compartida': 1, 'Marca SKU': 1 } }
  const { status, body } = await get('?q=MATCH')
  assert.equal(status, 200)
  assert.equal(body.total, 3)
  assert.deepEqual([...body.products.map(product => product.id)].sort(), ['facet-both', 'facet-sku', 'facet-text'])
  assert.deepEqual(body.facets, expectedFacets)
  assert.deepEqual(catalog.calls.map(call => call.searchParams.query), ['MATCH', ''])

  const seen = []
  for (let page = 1; page <= 3; page++) {
    const response = await get(`?q=MATCH&pageSize=1&page=${page}`)
    assert.equal(response.status, 200)
    assert.deepEqual([response.body.page, response.body.pageSize, response.body.total, response.body.totalPages], [page, 1, 3, 3])
    assert.equal(response.body.products.length, 1)
    assert.deepEqual(response.body.facets, expectedFacets)
    seen.push(response.body.products[0].id)
  }
  assert.deepEqual(seen.sort(), ['facet-both', 'facet-sku', 'facet-text'])
})

test('facets respetan Category, Brand, Branch, Availability y B2B antes de paginar', async t => {
  const records = [
    { ...QA_PRODUCTS[0], objectID: 'facet-a', title: 'MATCH texto', sku: 'MATCH.A', brand: 'Acme',
      categories: ['SSD', 'Almacenamiento'], stock_quantity: 5, in_stock: true,
      stock_by_branch: { san_jose: 5, alajuela: 0, cartago: 0, heredia: 0 } },
    { ...QA_PRODUCTS[0], objectID: 'facet-b', title: 'Elemento B', sku: 'MATCH.B', brand: 'Acme',
      categories: ['RAM', 'Componentes'], stock_quantity: 2, in_stock: true,
      stock_by_branch: { san_jose: 2, alajuela: 0, cartago: 0, heredia: 0 } },
    { ...QA_PRODUCTS[0], objectID: 'facet-c', title: 'Elemento C', sku: 'MATCH.C', brand: 'Beta',
      categories: ['SSD', 'Almacenamiento'], stock_quantity: 0, in_stock: false, b2b: { available: false },
      stock_by_branch: { san_jose: 0, alajuela: 0, cartago: 0, heredia: 0 } },
  ]
  const { get } = await setup(t, records)
  for (const [name, filters, ids, facets] of [
    ['sin filtros', {}, ['facet-a', 'facet-b', 'facet-c'],
      { categories: { SSD: 2, Almacenamiento: 2, RAM: 1, Componentes: 1 }, brands: { Acme: 2, Beta: 1 } }],
    ['Category', { categories: 'SSD' }, ['facet-a', 'facet-c'],
      { categories: { SSD: 2, Almacenamiento: 2 }, brands: { Acme: 1, Beta: 1 } }],
    ['Brand', { brands: 'Acme' }, ['facet-a', 'facet-b'],
      { categories: { SSD: 1, Almacenamiento: 1, RAM: 1, Componentes: 1 }, brands: { Acme: 2 } }],
    ['Branch disponible', { branchId: 'san_jose', availability: 'available' }, ['facet-a'],
      { categories: { SSD: 1, Almacenamiento: 1 }, brands: { Acme: 1 } }],
    ['Branch bajo MOQ', { branchId: 'san_jose', availability: 'below-moq' }, ['facet-b'],
      { categories: { RAM: 1, Componentes: 1 }, brands: { Acme: 1 } }],
    ['Branch agotada', { branchId: 'san_jose', availability: 'out-of-stock' }, ['facet-c'],
      { categories: { SSD: 1, Almacenamiento: 1 }, brands: { Beta: 1 } }],
    ['B2B elegible', { b2b: 'eligible' }, ['facet-a', 'facet-b'],
      { categories: { SSD: 1, Almacenamiento: 1, RAM: 1, Componentes: 1 }, brands: { Acme: 2 } }],
    ['B2B no disponible', { b2b: 'not-available' }, ['facet-c'],
      { categories: { SSD: 1, Almacenamiento: 1 }, brands: { Beta: 1 } }],
    ['combinados', { categories: 'SSD', brands: 'Acme', branchId: 'san_jose', availability: 'available', b2b: 'eligible' }, ['facet-a'],
      { categories: { SSD: 1, Almacenamiento: 1 }, brands: { Acme: 1 } }],
    ['combinados sin resultados', { categories: 'SSD', brands: 'Beta', branchId: 'san_jose', availability: 'available' }, [],
      { categories: {}, brands: {} }],
  ]) {
    await t.test(name, async () => {
      const response = await get('?' + new URLSearchParams({ q: 'MATCH', ...filters }))
      assert.equal(response.status, 200)
      assert.deepEqual(response.body.products.map(product => product.id), ids)
      assert.equal(response.body.total, ids.length)
      assert.deepEqual(response.body.facets, facets)
    })
  }
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

test('API: catálogo no verificable devuelve 503 en Admin y B2B, sin cambiar el listado B2C paginado', async t => {
  for (const [name, indicators] of [
    ['actual aproximado', { exhaustive: { nbHits: false } }],
    ['legacy aproximado', { exhaustiveNbHits: false }],
    ['indicadores contradictorios', { exhaustive: { nbHits: true }, exhaustiveNbHits: false }],
    ['sin indicadores', {}],
    ['indicador inválido', { exhaustive: { nbHits: 'PRIVATE upstream detail' } }],
  ]) {
    await t.test(name, async child => {
      const { get, catalog, origin } = await setup(child)
      child.mock.method(getAlgoliaClient(), 'searchSingleIndex', async input => {
        const response = await catalog.searchSingleIndex(input)
        delete response.exhaustive
        delete response.exhaustiveNbHits
        return { ...response, ...indicators }
      })
      const admin = await get('?q=QA-SSD-1TB')
      assert.equal(admin.status, 503)
      assert.equal(admin.body.error.code, 'CATALOG_RESULT_LIMIT')
      assert.equal('products' in admin.body, false)
      assert.ok(!JSON.stringify(admin.body).includes('PRIVATE'))
      const wholesale = await fetch(origin + '/api/products?perPage=2', { headers: { 'X-CiberNova-User-Id': 'qa-b2b' } })
      const wholesaleBody = await wholesale.json()
      assert.equal(wholesale.status, 503)
      assert.equal(wholesaleBody.error.code, 'CATALOG_RESULT_LIMIT')
      assert.equal('products' in wholesaleBody, false)
      assert.ok(!JSON.stringify(wholesaleBody).includes('PRIVATE'))
      const retail = await fetch(origin + '/api/products?perPage=2')
      assert.equal(retail.status, 200)
      assert.equal((await retail.json()).products.length, 2)
    })
  }
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
