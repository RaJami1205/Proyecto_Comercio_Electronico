import assert from 'node:assert/strict'
import { once } from 'node:events'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

// Configuración pública antes de importar Express o el cliente lazy del SDK.
Object.assign(process.env, {
  DOTENV_CONFIG_PATH: fileURLToPath(new URL('../.env.database.example', import.meta.url)),
  DOTENV_CONFIG_OVERRIDE: '', DOTENV_KEY: '', DOTENV_CONFIG_DOTENV_KEY: '',
  COMMERCE_STORE_MODE: 'memory', ORDER_CREATION_MODE: 'v1-compatible',
  ALGOLIA_APP_ID: 'test', ALGOLIA_API_KEY: 'test', ALGOLIA_INDEX_NAME: 'test_products',
})
const { default: app } = await import('../dist/app.js')
const { getCatalogPage } = await import('../dist/services/productService.js')
const { getAlgoliaClient } = await import('../dist/config/algolia.js')

test('los fallos del proveedor conservan su identidad y se sanitizan en Listing, Search y categorías', async t => {
  const failure = Object.assign(new Error('mensaje-ficticio-sensible'), {
    request: { headers: { authorization: 'token-ficticio-sensible' } },
    response: { body: 'respuesta-ficticia-sensible' },
  })
  const search = t.mock.method(getAlgoliaClient(), 'searchSingleIndex', async () => { throw failure })
  const logs = []
  for (const level of ['error', 'warn', 'log', 'info', 'debug', 'trace']) {
    t.mock.method(console, level, (...args) => logs.push([level, ...args]))
  }
  await assert.rejects(getCatalogPage(1, 20), error => error === failure)

  const server = app.listen(0, '127.0.0.1')
  t.after(() => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())))
  await once(server, 'listening')
  const catalog = 'http://127.0.0.1:' + server.address().port + '/api/products'
  const categories = catalog + '/categories/tree'
  for (const url of [catalog, catalog + '/search?q=consulta-ficticia', categories]) {
    const response = await fetch(url)
    assert.equal(response.status, 500)
    assert.deepEqual(await response.json(), { error: 'No se pudo completar la solicitud.' })
  }
  assert.deepEqual(logs, [
    ['error', 'Falló la consulta de catálogo en getCatalogPage.'],
    ['error', 'Falló la consulta de catálogo en getCatalogPage.'],
    ['error', 'Falló la consulta de catálogo en getProducts.'],
    ['error', 'Ocurrió un error inesperado al consultar productos.'],
    ['error', 'Falló la búsqueda en searchProductCatalog.'],
    ['error', 'Ocurrió un error inesperado al consultar productos.'],
    ['error', 'Falló la consulta de categorías en getCategoryTreeHandler.'],
    ['error', 'Ocurrió un error inesperado al consultar productos.'],
  ])

  search.mock.mockImplementation(async () => ({ hits: [], page: 0, nbHits: 0, nbPages: 1 }))
  for (const url of [catalog, catalog + '/search?q=ssd']) {
    const response = await fetch(url)
    assert.equal(response.status, 200)
    assert.deepEqual((await response.json()).products, [])
  }
  search.mock.mockImplementation(async () => ({ hits: [{ categories: ['Almacenamiento', 'SSD'] }] }))
  const response = await fetch(categories)
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), {
    tree: [{ name: 'Almacenamiento', children: [{ name: 'SSD', children: [] }] }],
  })
})
