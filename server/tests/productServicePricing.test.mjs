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
    {hits:hits.slice(0,1000),page:0,nbPages:2,nbHits:1001,hitsPerPage:1000,facets:{}},
    {hits:hits.slice(1000),page:1,nbPages:2,nbHits:1001,hitsPerPage:1000,facets:{}},
  ])
  const result=await service.getCatalogPage(1,1,{sort:'price_asc',minPrice:1,maxPrice:10},'ssd','B2B')
  assert.equal(client.calls.length,2)
  assert.deepEqual(client.calls.map(call=>call.indexName),['products','products'])
  assert.equal(client.calls[0].searchParams.query,'ssd')
  assert.deepEqual(result.hits.map(hit=>hit.objectID),['wholesale-best'])
  assert.equal(result.totalProducts,1)
})
