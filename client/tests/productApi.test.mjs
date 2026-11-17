/** Frontera real de CN-73: DTOs actuales desde unknown, con fetch aislado. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

const branchTypes = 'data:text/javascript;base64,' + Buffer.from("export const BRANCH_IDS=['san_jose','alajuela','cartago','heredia']").toString('base64')
const source = readFileSync(new URL('../src/services/productApi.ts', import.meta.url), 'utf8')
  .replace('import.meta.env.VITE_API_BASE_URL', 'undefined')
  .replaceAll("'../types/branch'", `'${branchTypes}'`).replaceAll('"../types/branch"', `'${branchTypes}'`)
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ESNext } }).outputText
const productApi = await import('data:text/javascript;base64,' + Buffer.from(compiled).toString('base64'))
const product = (id = 'p1') => ({ id, name:'Producto actual', image:'/ssd.png', price:99999.495, retailPrice:99999.495,
  pricing:{type:'RETAIL',eligible:true,minOrderQuantity:1,message:null},
  inventory:{branchId:null,quantity:null,status:'unselected',canFulfillMinimum:null,message:'Selecciona una sucursal.'},canAddToCart:false,
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

test('envía identidad y sucursal en catálogo, sugerencias e historial', async t => {
  const calls=[]
  t.mock.method(globalThis,'fetch',async (url,options={})=>{
    calls.push({url:String(url),headers:options.headers})
    return Response.json({products:[],page:1,totalPages:1,totalProducts:0,facets:{}})
  })
  await productApi.getCatalogPage(1,20,undefined,'', 'b2b-user','san_jose')
  await productApi.searchProducts('ssd','b2b-user','cartago')
  await productApi.getProductsByIds(['p1'],'b2b-user','heredia')
  assert.equal(calls[0].headers['X-CiberNova-User-Id'],'b2b-user')
  assert.equal(new URL(calls[0].url,'http://local').searchParams.get('branchId'),'san_jose')
  assert.equal(calls[1].headers['X-CiberNova-User-Id'],'b2b-user')
  assert.equal(new URL(calls[1].url,'http://local').searchParams.get('branchId'),'cartago')
  assert.equal(new URL(calls[2].url,'http://local').searchParams.get('branchId'),'heredia')
})

test('valida contrato de sucursales y disponibilidad', async t => {
  t.mock.method(globalThis,'fetch',async()=>Response.json({branches:[
    {id:'san_jose',name:'San José',available:true},{id:'alajuela',name:'Alajuela',available:false},
  ]}))
  assert.deepEqual(await productApi.getBranches(),[
    {id:'san_jose',name:'San José',available:true},{id:'alajuela',name:'Alajuela',available:false},
  ])
  t.mock.method(globalThis,'fetch',async()=>Response.json({branches:[{id:'desconocida',name:'X',available:true}]}))
  await assert.rejects(productApi.getBranches(),/sucursales inválidas/)
})
