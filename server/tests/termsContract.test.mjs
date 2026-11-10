/** Integración HTTP local: servicios Client reales y API Server real, catálogo simulado. No es un E2E de navegador. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mockUserDirectory, testIdentityHeaders } from './helpers/identity.mjs'
import {readFileSync} from 'node:fs'
import {createRequire} from 'node:module'
import app from '../dist/app.js'
import {orderService} from '../dist/services/orderService.js'
import {CURRENT_TERMS_VERSION} from '../dist/domain/termsPolicy.js'
import {OrderPersistenceError} from '../dist/domain/orderPersistenceError.js'
const requireClient=createRequire(new URL('../../client/package.json',import.meta.url))
const ts=requireClient('typescript')
/** Transpila el servicio Client real con la URL local del test, sin modificar fuentes ni configuración de Vite. */
function clientService(name,base){
  const source=readFileSync(new URL('../../client/src/services/'+name+'.ts',import.meta.url),'utf8').replace('import.meta.env.VITE_API_BASE_URL',JSON.stringify(base))
  const compiled=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2023,module:ts.ModuleKind.ESNext}}).outputText
  const helper=ts.transpileModule(readFileSync(new URL('../../client/src/utils/authorizationErrors.ts',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2023,module:ts.ModuleKind.ESNext}}).outputText
  const linked=compiled.replace('../utils/authorizationErrors','data:text/javascript;base64,'+Buffer.from(helper).toString('base64'))
  return import('data:text/javascript;base64,'+Buffer.from(linked).toString('base64'))
}

test('CN-47 Client/Server: errores, POST, GET, Payment Retry y confirmed replay con metadata real',async t=>{
  mockUserDirectory(t)
  const original=orderService.lookup
  orderService.lookup=async id=>({objectID:id,title:'Producto local',price:10000,image_url:'',in_stock:true,stock_quantity:5})
  const server=app.listen(0,'127.0.0.1')
  await new Promise(resolve=>server.once('listening',resolve))
  const base='http://127.0.0.1:'+server.address().port
  const realFetch=globalThis.fetch,sent=[]
  t.mock.method(globalThis,'fetch',async(url,options)=>{
    assert.ok(String(url).startsWith(base+'/api/orders'),'Solo HTTP local de prueba')
    if(options?.body)sent.push(JSON.parse(options.body))
    return realFetch(url,options)
  })
  try {
    const {orderApi,OrderApiError}=await clientService('orderApi',base)
    const {paymentApi}=await clientService('paymentApi',base)
    const input={buyer:{fullName:'Prueba',email:'test@example.com',phone:'88888888'},delivery:{province:'San José',canton:'Central',address:'Ficticia'},items:[{productId:'p',quantity:1}],idempotencyKey:'integration',termsAcceptance:{accepted:true,version:CURRENT_TERMS_VERSION,acceptedAt:'forged'}}
    for(const [termsAcceptance,field] of [[{accepted:false,version:CURRENT_TERMS_VERSION},'accepted'],[{accepted:true,version:'unknown'},'version']]){
      await assert.rejects(orderApi.createOrder({...input,termsAcceptance}, 'test-user'),error=>error instanceof OrderApiError && error.conclusive && !!error.fieldErrors['termsAcceptance.'+field])
    }
    const missing=await fetch(base+'/api/orders',{method:'POST',headers:{'Content-Type':'application/json', ...testIdentityHeaders},body:JSON.stringify({...input,termsAcceptance:undefined})})
    assert.equal(missing.status,400)
    assert.ok((await missing.json()).error.fieldErrors['termsAcceptance.accepted'])
    const created=await orderApi.createOrder(input, 'test-user')
    assert.deepEqual(sent.at(-1).termsAcceptance,{accepted:true,version:CURRENT_TERMS_VERSION})
    assert.deepEqual(created.termsAcceptance,{accepted:true,version:CURRENT_TERMS_VERSION,acceptedAt:created.createdAt})
    assert.equal(new Date(created.termsAcceptance.acceptedAt).toISOString(),created.termsAcceptance.acceptedAt)
    const fetched=await fetch(base+'/api/orders/'+created.id, { headers: testIdentityHeaders })
    assert.equal(fetched.status,200);assert.deepEqual(await fetched.json(),created)
    const replay=await fetch(base+'/api/orders',{method:'POST',headers:{'Content-Type':'application/json', ...testIdentityHeaders},body:JSON.stringify(input)})
    assert.equal(replay.status,201);assert.deepEqual(await replay.json(),created)
    const forged=await fetch(base+'/api/orders',{method:'POST',headers:{'Content-Type':'application/json', ...testIdentityHeaders},body:JSON.stringify({...input,idempotencyKey:'forged-time'})})
    assert.equal(forged.status,201)
    const forgedOrder=await forged.json()
    assert.equal(forgedOrder.termsAcceptance.acceptedAt,forgedOrder.createdAt)
    assert.notEqual(forgedOrder.termsAcceptance.acceptedAt,'forged')
    // Mantiene la clasificación preexistente de conflictos; no genera otra key.
    await assert.rejects(orderApi.createOrder({...input,buyer:{...input.buyer,fullName:'Otro'}}, 'test-user'),error=>error instanceof OrderApiError && !error.conclusive && !!error.fieldErrors.idempotencyKey)
    let approved
    for(const scenario of ['PAYMENT_ERROR','PAYMENT_DECLINED','PAYMENT_APPROVED']){
      const payment={scenario,idempotencyKey:scenario}
      const result=await paymentApi.processPayment(created.id,payment, 'test-user')
      assert.deepEqual(result.order.termsAcceptance,created.termsAcceptance)
      assert.deepEqual(await paymentApi.processPayment(created.id,payment, 'test-user'),result)
      assert.deepEqual((await (await fetch(base+'/api/orders/'+created.id, { headers: testIdentityHeaders })).json()).termsAcceptance,created.termsAcceptance)
      approved=result
    }
    assert.equal(approved.order.orderStatus,'CONFIRMED')
    assert.equal(approved.order.paymentStatus,'APPROVED')
    assert.deepEqual(await orderApi.createOrder(input, 'test-user'),approved.order)
  } finally {
    orderService.lookup=original
    await new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()))
  }
})
test('CN-58 HTTP 503 y outcome unknown conservan el intento en el Client V1 sin exponer errores internos',async t=>{
  mockUserDirectory(t)
  const server=app.listen(0,'127.0.0.1')
  await new Promise(resolve=>server.once('listening',resolve))
  t.after(()=>new Promise(resolve=>server.close(resolve)))
  const base='http://127.0.0.1:'+server.address().port
  const {orderApi,OrderApiError}=await clientService('orderApi',base)
  const input={buyer:{fullName:'Test',email:'test@example.com',phone:'88888888'},delivery:{province:'San José',canton:'Central',address:'Prueba'},
    items:[{productId:'p',quantity:1}],idempotencyKey:'same-key',termsAcceptance:{accepted:true,version:CURRENT_TERMS_VERSION}}
  for(const outcome of ['not-committed','unknown']){
    const mock=t.mock.method(orderService,'create',async()=>{throw new OrderPersistenceError(outcome)})
    const response=await fetch(base+'/api/orders',{method:'POST',headers:{...testIdentityHeaders,'Content-Type':'application/json'},body:JSON.stringify(input)})
    assert.equal(response.status,503)
    const body=await response.json()
    assert.equal(body.error.code,'UNEXPECTED_ERROR')
    assert.equal(body.error.outcome,outcome==='unknown'?'unknown':undefined)
    assert.doesNotMatch(JSON.stringify(body),/password|certificate|postgres:\/\//i)
    await assert.rejects(orderApi.createOrder(input,'test-user'),error=>error instanceof OrderApiError&&!error.conclusive&&error.code==='UNEXPECTED_ERROR')
    mock.mock.restore()
  }
})
