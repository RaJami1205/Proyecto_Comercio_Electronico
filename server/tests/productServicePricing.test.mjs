import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from '../../client/node_modules/typescript/lib/typescript.js'

const dataUrl = source => 'data:text/javascript;base64,' + Buffer.from(source).toString('base64')
const compile = path => ts.transpileModule(readFileSync(new URL('../src/' + path, import.meta.url), 'utf8'),
  { compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ESNext } }).outputText
const clientUrl = dataUrl(`globalThis.__calls=[];globalThis.__pages=[];
  export function reset(pages){globalThis.__pages=pages;globalThis.__calls.length=0}
  export const calls=globalThis.__calls;
  export function getAlgoliaClient(){return {async searchSingleIndex(input){globalThis.__calls.push(input);return globalThis.__pages[input.searchParams.page]}}}`)
const configUrl = dataUrl("export function getAlgoliaConfig(){return {indexName:'products'}}")
const errorUrl = dataUrl(compile('domain/catalogError.ts'))
const pricingUrl = dataUrl(compile('domain/pricing.ts'))
const serviceSource = compile('services/productService.ts')
  .replace("from '../config/algolia.js'", `from ${JSON.stringify(clientUrl)}`)
  .replace("from '../config/env.js'", `from ${JSON.stringify(configUrl)}`)
  .replace("from '../domain/catalogError.js'", `from ${JSON.stringify(errorUrl)}`)
  .replace("from '../domain/pricing.js'", `from ${JSON.stringify(pricingUrl)}`)
const serviceUrl = dataUrl(serviceSource)
const client = await import(clientUrl)
const service = await import(serviceUrl)
const record = (id, price) => ({objectID:id,title:id,price:price*2,b2b:{available:true,wholesale_price:price,min_order_quantity:1}})

test('B2C conserva las réplicas y filtros minoristas de Algolia', async () => {
  client.reset([{hits:[],page:0,nbPages:1,nbHits:0,facets:{}}])
  await service.getCatalogPage(1,20,{sort:'price_asc',minPrice:100},'ssd','B2C')
  assert.equal(client.calls[0].indexName,'products_price_asc')
  assert.deepEqual(client.calls[0].searchParams.numericFilters,['price>=100'])
})

test('B2B ordena sobre todas las páginas del conjunto antes de aplicar la paginación', async () => {
  const hits=Array.from({length:1001},(_,index)=>record(`p${index}`,1000+index))
  hits[1000]=record('wholesale-best',1)
  client.reset([
    {hits:hits.slice(0,1000),page:0,nbPages:2,nbHits:1001,hitsPerPage:1000,facets:{},exhaustive:{nbHits:true}},
    {hits:hits.slice(1000),page:1,nbPages:2,nbHits:1001,hitsPerPage:1000,facets:{},exhaustive:{nbHits:true}},
  ])
  const result=await service.getCatalogPage(1,1,{sort:'price_asc',minPrice:1,maxPrice:10},'ssd','B2B')
  assert.equal(client.calls.length,2)
  assert.deepEqual(client.calls.map(call=>call.indexName),['products','products'])
  assert.equal(client.calls[0].searchParams.query,'ssd')
  assert.deepEqual(result.hits.map(hit=>hit.objectID),['wholesale-best'])
  assert.equal(result.totalProducts,1)
})

// Respuesta estándar de searchSingleIndex, sin depender de variables de entorno ni settings remotos.
const catalogPage = (hits, indicators = { exhaustive: { nbHits: true } }, overrides = {}) => ({
  hits, page: 0, hitsPerPage: 1000, nbHits: hits.length, nbPages: Math.ceil(hits.length / 1000), facets: {},
  ...indicators, ...overrides,
})
const incompleteCatalog = error => error.status === 503 && error.code === 'CATALOG_RESULT_LIMIT'

test('getCompleteCatalog admite evidencia exhaustiva actual, legacy y consistente sin modificar registros', async t => {
  for (const [name, indicators] of [
    ['actual', { exhaustive: { nbHits: true } }],
    ['legacy', { exhaustiveNbHits: true }],
    ['ambos true', { exhaustive: { nbHits: true }, exhaustiveNbHits: true }],
    ['legacy con otros metadatos actuales', { exhaustive: { facetsCount: false }, exhaustiveNbHits: true }],
    ['nbHits exacto con facets aproximados', { exhaustive: { nbHits: true, facetsCount: false } }],
  ]) {
    await t.test(name, async () => {
      const hits = [record('p1', 1.2345)]
      const original = structuredClone(hits)
      client.reset([catalogPage(hits, indicators)])
      const result = await service.getCompleteCatalog('ssd', { categories: ['SSD'], brands: ['Marca'] })
      assert.deepEqual(result.hits, original)
      assert.deepEqual(hits, original)
      assert.equal(client.calls.length, 1)
      assert.deepEqual(client.calls[0].searchParams.facetFilters, [['categories:SSD'], ['brand:Marca']])
    })
  }
})

test('getCompleteCatalog rechaza indicadores aproximados, ausentes, mal formados o contradictorios', async t => {
  for (const [name, indicators] of [
    ['actual false', { exhaustive: { nbHits: false } }],
    ['legacy false', { exhaustiveNbHits: false }],
    ['ambos false', { exhaustive: { nbHits: false }, exhaustiveNbHits: false }],
    ['actual true y legacy false', { exhaustive: { nbHits: true }, exhaustiveNbHits: false }],
    ['actual false y legacy true', { exhaustive: { nbHits: false }, exhaustiveNbHits: true }],
    ['ambos ausentes', {}],
    ['actual sin nbHits', { exhaustive: {} }],
    ['solo exactitud de facets', { exhaustive: { facetsCount: true } }],
    ['actual null', { exhaustive: { nbHits: null } }],
    ['actual string', { exhaustive: { nbHits: 'true' } }],
    ['actual número', { exhaustive: { nbHits: 1 } }],
    ['legacy string', { exhaustiveNbHits: 'true' }],
    ['legacy null', { exhaustiveNbHits: null }],
    ['objeto actual null', { exhaustive: null }],
    ['objeto actual inválido', { exhaustive: true }],
    ['objeto actual array', { exhaustive: [] }],
    ['actual inválido y legacy true', { exhaustive: { nbHits: 'false' }, exhaustiveNbHits: true }],
    ['actual true y legacy inválido', { exhaustive: { nbHits: true }, exhaustiveNbHits: 'false' }],
  ]) {
    await t.test(name, async () => {
      // nbHits, nbPages y la cantidad de registros son coherentes: eso no sustituye la evidencia de exactitud.
      client.reset([catalogPage([record('p1', 100)], indicators)])
      await assert.rejects(service.getCompleteCatalog('ssd'), incompleteCatalog)
      assert.equal(client.calls.length, 1)
    })
  }
})

test('getCompleteCatalog verifica cada página y acepta formatos compatibles en páginas sucesivas', async t => {
  const hits = Array.from({ length: 1001 }, (_, index) => record(`page-${index}`, index + 1))
  for (const [name, indicators, accepted] of [
    ['segunda página actual no exhaustiva', { exhaustive: { nbHits: false } }, false],
    ['segunda página legacy no exhaustiva', { exhaustiveNbHits: false }, false],
    ['segunda página sin evidencia', {}, false],
    ['segunda página legacy exhaustiva', { exhaustiveNbHits: true }, true],
  ]) {
    await t.test(name, async () => {
      client.reset([
        catalogPage(hits.slice(0, 1000), undefined, { nbHits: 1001, nbPages: 2 }),
        catalogPage(hits.slice(1000), indicators, { page: 1, nbHits: 1001, nbPages: 2 }),
      ])
      if (accepted) assert.deepEqual((await service.getCompleteCatalog('')).hits, hits)
      else await assert.rejects(service.getCompleteCatalog(''), incompleteCatalog)
      assert.deepEqual(client.calls.map(call => call.searchParams.page), [0, 1])
    })
  }
})

test('getCompleteCatalog distingue un catálogo vacío exhaustivo de uno sin metadatos verificables', async () => {
  client.reset([catalogPage([])])
  assert.deepEqual(await service.getCompleteCatalog(''), { hits: [], facets: {} })
  client.reset([catalogPage([], {})])
  await assert.rejects(service.getCompleteCatalog(''), incompleteCatalog)
})

test('getCompleteCatalog conserva las guardas de metadatos y páginas incompletas', async t => {
  for (const [name, overrides] of [
    ['nbHits inválido', { nbHits: -1 }], ['nbPages inválido', { nbPages: 1.5 }],
    ['número de páginas incoherente', { nbPages: 2 }], ['page incorrecta', { page: 1 }],
    ['hitsPerPage incorrecto', { hitsPerPage: 20 }], ['página incompleta', { nbHits: 2 }], ['hits inválido', { hits: null }],
  ]) {
    await t.test(name, async () => {
      client.reset([catalogPage([record('p1', 100)], undefined, overrides)])
      await assert.rejects(service.getCompleteCatalog(''), incompleteCatalog)
    })
  }
  const hits = Array.from({ length: 1000 }, (_, index) => record(`changed-${index}`, index + 1))
  client.reset([
    catalogPage(hits, undefined, { nbHits: 1001, nbPages: 2 }),
    catalogPage([record('last', 1)], undefined, { page: 1, nbHits: 1002, nbPages: 2 }),
  ])
  await assert.rejects(service.getCompleteCatalog(''), incompleteCatalog)
})

test('getCompleteCatalog rechaza IDs repetidos dentro de una página y entre páginas', async () => {
  client.reset([catalogPage([record('same', 100), record('same', 200)])])
  await assert.rejects(service.getCompleteCatalog(''), incompleteCatalog)
  const hits = Array.from({ length: 1000 }, (_, index) => record(`unique-${index}`, index + 1))
  client.reset([
    catalogPage(hits, undefined, { nbHits: 1001, nbPages: 2 }),
    catalogPage([hits[0]], undefined, { page: 1, nbHits: 1001, nbPages: 2 }),
  ])
  await assert.rejects(service.getCompleteCatalog(''), incompleteCatalog)
  client.reset([catalogPage([{ title: 'Sin ID', price: 100 }])])
  await assert.rejects(service.getCompleteCatalog(''), incompleteCatalog)
})

test('getCompleteCatalog mantiene el máximo de 100 páginas sin devolver una parte del catálogo', async () => {
  client.reset(Array.from({ length: 101 }, (_, page) => catalogPage(
    Array.from({ length: page === 100 ? 1 : 1000 }, (_, index) => record(`limit-${page}-${index}`, 1)),
    undefined, { page, nbHits: 100001, nbPages: 101 },
  )))
  await assert.rejects(service.getCompleteCatalog(''), incompleteCatalog)
  assert.equal(client.calls.length, 100)
  assert.equal(client.calls.at(-1).searchParams.page, 99)
})
