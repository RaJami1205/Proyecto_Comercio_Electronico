/** Frontera real de CN-73: DTOs actuales desde unknown, con fetch aislado. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

const source = readFileSync(new URL('../src/services/productApi.ts', import.meta.url), 'utf8').replace('import.meta.env.VITE_API_BASE_URL', 'undefined')
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ESNext } }).outputText
const productApi = await import('data:text/javascript;base64,' + Buffer.from(compiled).toString('base64'))
const product = (id = 'p1') => ({ id, name:'Producto actual', image:'/ssd.png', price:99999.495,
  category:'Almacenamiento', inStock:true, description:'Descripción', specifications:[{label:'Capacidad',value:'2 TB'}] })

test('resuelve hasta diez IDs codificados; conserva recencia y datos exactos; omite inexistentes', async t => {
  const calls = []
  t.mock.method(globalThis, 'fetch', async url => {
    calls.push(String(url))
    const ids = new URL(String(url),'http://local.test').searchParams.getAll('ids')
    return Response.json({ products: ids.filter(id=>id!=='missing').reverse().map(id=>({...product(id),internal:'discard',specifications:[{label:'Capacidad',value:'2 TB',extra:true}]})), page:1 })
  })
  assert.deepEqual(await productApi.getProductsByIds([]), [])
  assert.equal(calls.length,0)
  assert.deepEqual(await productApi.getProductsByIds(['p/1','p 2','missing','p/1']),[product('p/1'),product('p 2')])
  assert.match(calls[0],/^\/api\/products\?ids=p%2F1&ids=p\+2&ids=missing$/)
  const twelve = await productApi.getProductsByIds(Array.from({length:12},(_,i)=>'p'+i))
  assert.equal(twelve.length,10)
  assert.equal(new URL(calls[1],'http://local.test').searchParams.getAll('ids').length,10)
  assert.deepEqual(await productApi.getProductsByIds(['missing']),[])
})

const invalid = [
  ['products null',()=>({products:null})],
  ['products ausente',()=>({})],
  ['elemento null',()=>({products:[null]})],
  ['elemento primitivo',()=>({products:['p1']})],
  ['ID inesperado',()=>({products:[product('other')]})],
  ['ID duplicado',()=>({products:[product(),product()]})],
  ['precio negativo',()=>({products:[{...product(),price:-1}]})],
  ['precio no finito',()=>({products:[{...product(),price:Infinity}]})],
  ['stock inválido',()=>({products:[{...product(),inStock:'true'}]})],
  ['categoría inválida',()=>({products:[{...product(),category:[]} ]})],
  ['especificaciones null',()=>({products:[{...product(),specifications:null}]})],
  ['especificación inválida',()=>({products:[{...product(),specifications:[{label:'RAM',value:16}]}]})],
  ...Object.keys(product()).map(key=>['campo obligatorio '+key,()=>{const item=product();delete item[key];return {products:[item]}}]),
]
for (const [name,payload] of invalid) test('rechaza respuesta 200 inválida: '+name,async t=>{
  t.mock.method(globalThis,'fetch',async()=>Response.json(payload()))
  await assert.rejects(productApi.getProductsByIds(['p1']),/inválid|inesperado/)
})

for (const status of [400,404,500,503]) test('propaga HTTP '+status+' sin aceptar productos',async t=>{
  t.mock.method(globalThis,'fetch',async()=>Response.json({products:[product()]},{status}))
  await assert.rejects(productApi.getProductsByIds(['p1']),new RegExp(String(status)))
})
test('propaga red y JSON inválido; IDs vacíos no alcanzan el Server',async t=>{
  const mock=t.mock.method(globalThis,'fetch',async()=>{throw new Error('network')})
  await assert.rejects(productApi.getProductsByIds(['p1']),/network/)
  mock.mock.mockImplementation(async()=>new Response('{',{status:200,headers:{'Content-Type':'application/json'}}))
  await assert.rejects(productApi.getProductsByIds(['p1']))
  const count=mock.mock.callCount()
  await assert.rejects(productApi.getProductsByIds([' ']))
  assert.equal(mock.mock.callCount(),count)
})
