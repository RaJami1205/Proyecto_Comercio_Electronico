/** CN-47: validación, rotación y concurrencia con fuentes reales aisladas, sin env/Algolia. */
import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {stripTypeScriptTypes} from 'node:module'
const dataUrl=source=>'data:text/javascript;base64,'+Buffer.from(source).toString('base64')
async function domain(rotation=false){
  const sources=new Map([['services/productService',dataUrl('export async function getProductById(){throw new Error("Catálogo real prohibido")}')]])
  for(const name of ['domain/termsPolicy','domain/orderError','domain/orderValidation','domain/orderCalculations','stores/orderStore','domain/paymentValidation','services/paymentSandboxService','services/paymentService','services/orderService']){
    let source=readFileSync(new URL('../src/'+name+'.ts',import.meta.url),'utf8')
    // Solo este módulo en memoria admite rotación; producción mantiene una única versión real.
    if(rotation && name==='domain/termsPolicy') source=source.replace('export const CURRENT_TERMS_VERSION', 'export let CURRENT_TERMS_VERSION').replace('Object.freeze([CURRENT_TERMS_VERSION])', "Object.freeze([CURRENT_TERMS_VERSION, 'test-v2'])")+"\nexport function rotateForTest(){CURRENT_TERMS_VERSION='test-v2'}"
    const compiled=stripTypeScriptTypes(source,{mode:'transform'}).replace(/from ['"](\.[^'"]+)['"]/g,(_,path)=>{
      const key=new URL(path,'https://local/'+name+'.js').pathname.slice(1).replace(/\.js$/,'')
      assert.ok(sources.has(key),key); return 'from '+JSON.stringify(sources.get(key))
    })
    sources.set(name,dataUrl(compiled))
  }
  return {...await import(sources.get('services/orderService')),...await import(sources.get('stores/orderStore')),...await import(sources.get('services/paymentService')),policy:await import(sources.get('domain/termsPolicy'))}
}
const {OrderService,InMemoryOrderStore,PaymentService,policy}=await domain()
const request=()=>({buyer:{fullName:'Test',email:'test@example.com',phone:'88888888'},delivery:{province:'San José',canton:'Central',address:'Prueba'},items:[{productId:'p',quantity:1}],idempotencyKey:'terms',termsAcceptance:{accepted:true,version:policy.CURRENT_TERMS_VERSION}})
const product={objectID:'p',title:'Prueba',price:10000,in_stock:true,stock_quantity:10}
const invalid=error=>error.status===400 && error.code==='CHECKOUT_VALIDATION_ERROR'
const conflict=error=>error.status===409 && !!error.fieldErrors.idempotencyKey

for(const [label,terms,field] of [
  ['ausente',undefined,'accepted'],['null',null,'accepted'],['array',[],'accepted'],['string','true','accepted'],['number',1,'accepted'],
  ['objeto vacío',{},'accepted'],['accepted ausente',{version:policy.CURRENT_TERMS_VERSION},'accepted'],
  ...[false,'true',1,0,null].map(accepted=>['accepted '+String(accepted),{accepted,version:policy.CURRENT_TERMS_VERSION},'accepted']),
  ...[undefined,'',' ',12,null,'unknown',' '+policy.CURRENT_TERMS_VERSION].map(version=>['version '+String(version),{accepted:true,version},'version']),
])test('CN-47 rechaza '+label+' sin reservar key ni consultar catálogo',async()=>{
  let calls=0
  const store=new InMemoryOrderStore(),service=new OrderService(store,async()=>{calls++;return product})
  const input={...request(),termsAcceptance:terms}
  await assert.rejects(service.create(input),error=>invalid(error)&&!!error.fieldErrors['termsAcceptance.'+field])
  assert.equal(calls,0);assert.equal(store.findByIdempotencyKey(input.idempotencyKey),undefined)
  const corrected=await service.create(request())
  assert.equal(calls,1);assert.equal(corrected.termsAcceptance.accepted,true)
})

test('CN-47 metadata autoritativa, timestamp Client ignorado, GET y copias defensivas',async()=>{
  let calls=0
  const store=new InMemoryOrderStore(),service=new OrderService(store,async()=>{calls++;return product})
  const input=request();input.termsAcceptance.acceptedAt='1900-01-01T00:00:00.000Z';input.termsAcceptance.extra='ignored'
  const first=await service.create(input)
  assert.deepEqual(first.termsAcceptance,{accepted:true,version:policy.CURRENT_TERMS_VERSION,acceptedAt:first.createdAt})
  assert.equal(new Date(first.termsAcceptance.acceptedAt).toISOString(),first.termsAcceptance.acceptedAt)
  const snapshot=structuredClone(first)
  first.termsAcceptance.version='mutated';first.termsAcceptance.acceptedAt='mutated'
  assert.deepEqual(service.findById(first.id),snapshot)
  assert.deepEqual(await service.create(input),snapshot)
  assert.equal(calls,1)
  await assert.rejects(service.create({...input,termsAcceptance:{...input.termsAcceptance,accepted:false}}),invalid)
  assert.deepEqual(service.findById(first.id),snapshot)
})

test('CN-47 diez concurrentes comparten snapshot; conflicto no elimina pending; request se copia',async()=>{
  let release,calls=0
  const gate=new Promise(resolve=>{release=resolve}),store=new InMemoryOrderStore()
  const service=new OrderService(store,async()=>{calls++;await gate;return product})
  const original=request(),pending=Array.from({length:10},()=>service.create(original))
  original.termsAcceptance.version='mutated-after-call'
  await assert.rejects(service.create({...request(),buyer:{...request().buyer,fullName:'Otro'}}),conflict)
  await assert.rejects(service.create({...request(),items:[{productId:'p',quantity:2}]}),conflict)
  release()
  const results=await Promise.all(pending)
  assert.equal(calls,1)
  for(const result of results)assert.deepEqual(result,results[0])
  assert.equal(results[0].termsAcceptance.version,policy.CURRENT_TERMS_VERSION)
  results[0].termsAcceptance.version='changed-copy'
  assert.equal(results[1].termsAcceptance.version,policy.CURRENT_TERMS_VERSION)
})

test('CN-47 rotación controlada: pending histórico, replay, conflicto y key nueva retirada',async()=>{
  const rotated=await domain(true)
  let release,calls=0
  const gate=new Promise(resolve=>{release=resolve}),store=new rotated.InMemoryOrderStore()
  const service=new rotated.OrderService(store,async()=>{calls++;await gate;return product})
  const input=request(),first=service.create(input)
  rotated.policy.rotateForTest()
  const retry=service.create(input)
  await assert.rejects(service.create({...input,termsAcceptance:{accepted:true,version:'test-v2'}}),conflict)
  await assert.rejects(service.create({...input,idempotencyKey:'new-historical'}),error=>invalid(error)&&!!error.fieldErrors['termsAcceptance.version'])
  assert.equal(store.findByIdempotencyKey('new-historical'),undefined)
  release()
  const [order,replayed]=await Promise.all([first,retry])
  assert.deepEqual(order,replayed);assert.equal(calls,1)
  assert.deepEqual(await service.create(input),order)
  await assert.rejects(service.create({...input,termsAcceptance:{accepted:true,version:'test-v2'}}),conflict)
  assert.equal((await service.create({...input,idempotencyKey:'new-historical',termsAcceptance:{accepted:true,version:'test-v2'}})).termsAcceptance.version,'test-v2')
})

test('CN-47 fallo libera pending y permite recuperar con la misma identidad',async()=>{
  let failed=true
  const store=new InMemoryOrderStore(),service=new OrderService(store,async()=>{if(failed)throw new Error('local failure');return product})
  const outcomes=await Promise.allSettled([service.create(request()),service.create(request())])
  assert.ok(outcomes.every(o=>o.status==='rejected'))
  assert.equal(store.findByIdempotencyKey('terms'),undefined)
  failed=false
  const order=await service.create(request())
  assert.deepEqual(await service.create(request()),order)
})

test('CN-47 Payment Error/Declined/Approved, Retry y confirmed replay conservan aceptación',async()=>{
  const store=new InMemoryOrderStore(),service=new OrderService(store,async()=>product),payments=new PaymentService(store)
  const order=await service.create(request())
  for(const scenario of ['PAYMENT_ERROR','PAYMENT_DECLINED','PAYMENT_APPROVED']){
    const input={scenario,idempotencyKey:scenario}
    const result=await payments.process(order.id,input)
    assert.deepEqual(result.order.termsAcceptance,order.termsAcceptance)
    assert.deepEqual(service.findById(order.id).termsAcceptance,order.termsAcceptance)
    result.order.termsAcceptance.version='mutated'
    assert.deepEqual((await payments.process(order.id,input)).order.termsAcceptance,order.termsAcceptance)
  }
  const replay=await service.create(request())
  assert.equal(replay.orderStatus,'CONFIRMED')
  assert.deepEqual(replay.termsAcceptance,order.termsAcceptance)
})
