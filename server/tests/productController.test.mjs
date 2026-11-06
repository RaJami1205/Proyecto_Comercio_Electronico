/** Controller y mapper reales con directorio aislado; contratos HTTP en loopback. */
import test, { before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
import { once } from 'node:events'
import { readFileSync } from 'node:fs'
import ts from '../../client/node_modules/typescript/lib/typescript.js'

const dataUrl = source => 'data:text/javascript;base64,' + Buffer.from(source).toString('base64')
const fixture = id => ({objectID:id,title:'Actual '+id,price:1234.567,image_url:'/current.png',
  categories:['Almacenamiento','Interno'],description:'Vigente',in_stock:true,facets:{capacity:'2 TB'}})
const servicesUrl=dataUrl([
  'export const requestedIds=[],catalogCalls=[];',
  'export function reset(){requestedIds.length=0;catalogCalls.length=0;}',
  'const record='+fixture.toString()+';',
  'export async function getProductById(id){requestedIds.push(id);if(id==="failure")throw new Error("Catalog unavailable");return id==="missing"?undefined:record(id);}',
  'export async function getCatalogPage(...args){catalogCalls.push(args);return {hits:[record("catalog")],page:args[0],totalPages:3,totalProducts:1,facets:{}};}',
  'export async function searchProducts(){return [];}',
].join('\n'))
const directory=await import(servicesUrl)
const compile=file=>ts.transpileModule(readFileSync(new URL('../src/'+file,import.meta.url),'utf8'),
  {compilerOptions:{target:ts.ScriptTarget.ES2023,module:ts.ModuleKind.ESNext}}).outputText
const mapperUrl=dataUrl(compile('mappers/productMapper.ts'))
const categoriesUrl=dataUrl('export async function getCategoryTree(){return []}')
const controller=await import(dataUrl(compile('controllers/productController.ts').replace(/from ['"]([^'"]+)['"]/g,(_,dependency)=>
  'from '+JSON.stringify(dependency.includes('productService')?servicesUrl:dependency.includes('productMapper')?mapperUrl:categoriesUrl))))

let server,base
before(async()=>{
  const app=express()
  app.get('/api/products',controller.getProducts)
  app.use((_error,_request,response,_next)=>response.status(500).json({error:'No se pudo completar la solicitud.'}))
  server=app.listen(0,'127.0.0.1')
  await once(server,'listening')
  base='http://127.0.0.1:'+server.address().port+'/api/products'
})
after(async()=>{if(server)await new Promise(resolve=>server.close(resolve))})
beforeEach(()=>directory.reset())
const get=async query=>{const response=await fetch(base+query);return {status:response.status,body:await response.json()}}
const expected=id=>({id,name:'Actual '+id,price:1234.567,image:'/current.png',category:'Almacenamiento',
  description:'Vigente',inStock:true,specifications:[{label:'Capacity',value:'2 TB'}]})

test('HTTP sin ids conserva Listing, query y paginación',async()=>{
  const result=await get('?q=ssd&page=3&perPage=2')
  assert.equal(result.status,200)
  assert.deepEqual(result.body.products,[expected('catalog')])
  assert.equal(result.body.page,3)
  assert.equal(directory.catalogCalls.length,1)
  assert.equal(directory.catalogCalls[0][0],3)
  assert.equal(directory.catalogCalls[0][1],2)
  assert.equal(directory.catalogCalls[0][3],'ssd')
  assert.deepEqual(directory.requestedIds,[])
})
for(const query of ['?ids','?ids=','?ids=%20%20','?ids=%2C%3B%7C%20','?ids=&ids=p1'])test('HTTP ids inválidos no ejecutan Listing: '+query,async()=>{
  const result=await get(query)
  assert.equal(result.status,400)
  assert.equal(typeof result.body.error,'string')
  assert.deepEqual(directory.requestedIds,[])
  assert.deepEqual(directory.catalogCalls,[])
})
test('HTTP ids válidos conserva orden/dedup y omite inexistentes usando mapper real',async()=>{
  const result=await get('?ids=p2&ids=missing&ids=p2&ids=p1')
  assert.equal(result.status,200)
  assert.deepEqual(directory.requestedIds,['p2','missing','p1'])
  assert.deepEqual(result.body.products,[expected('p2'),expected('p1')])
  assert.equal(result.body.totalProducts,2)
  assert.deepEqual(directory.catalogCalls,[])
})
test('HTTP producto inexistente devuelve lista vacía',async()=>{
  const result=await get('?ids=missing')
  assert.equal(result.status,200)
  assert.deepEqual(result.body.products,[])
})
for(const count of [10,11])test('HTTP límite de IDs: '+count,async()=>{
  const query='?'+Array.from({length:count},(_,i)=>'ids=p'+i).join('&')
  const result=await get(query)
  assert.equal(result.status,count===10?200:400)
  assert.equal(directory.requestedIds.length,count===10?10:0)
  assert.deepEqual(directory.catalogCalls,[])
})
test('HTTP fallo del catálogo produce error y no una respuesta parcial',async t=>{
  t.mock.method(console,'error',()=>{})
  const result=await get('?ids=p1&ids=failure')
  assert.equal(result.status,500)
  assert.equal(typeof result.body.error,'string')
  assert.equal(result.body.products,undefined)
  assert.deepEqual(directory.catalogCalls,[])
})
for(const ids of [null,{},[1],[],['p1',null]])test('controller rechaza tipo/estructura inválida: '+JSON.stringify(ids),async()=>{
  const response={code:200,status(code){this.code=code;return this},json(body){this.body=body}}
  await controller.getProducts({query:{ids}},response,error=>{throw error})
  assert.equal(response.code,400)
  assert.deepEqual(directory.requestedIds,[])
  assert.deepEqual(directory.catalogCalls,[])
})
