import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

async function loadSource(file) {
  const source = readFileSync(new URL('../src/' + file, import.meta.url), 'utf8')
  const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ESNext } }).outputText
  return import('data:text/javascript;base64,' + Buffer.from(compiled).toString('base64'))
}
const {cartReducer} = await loadSource('context/cartReducer.ts')
const {createPaidOrderCartCleanup} = await loadSource('utils/paidOrderCartCleanup.ts')
const {saveCart, loadCart, CART_STORAGE_KEY} = await loadSource('utils/cartStorage.ts')
const product = {productId:'product-1', name:'Producto', price:10000, image:'', quantity:2}

test('solo CONFIRMED/APPROVED limpia; crear orden, rechazo y error conservan productos', () => {
  let cart = {items:[{...product}]}
  let clears = 0
  const cleanup = createPaidOrderCartCleanup(() => { clears++; cart = cartReducer(cart, {type:'CLEAR_CART'}) })
  for (const order of [undefined, {id:'pending',orderStatus:'PENDING',paymentStatus:'PENDING'}, {id:'declined',orderStatus:'PENDING',paymentStatus:'DECLINED'}, {id:'error',orderStatus:'PENDING',paymentStatus:'ERROR'}, {id:'invalid-1',orderStatus:'PENDING',paymentStatus:'APPROVED'}, {id:'invalid-2',orderStatus:'CONFIRMED',paymentStatus:'PENDING'}]) {
    cleanup(order)
    assert.deepEqual(cart.items,[product])
    assert.equal(clears,0)
  }
  const approved = {id:'approved',orderStatus:'CONFIRMED',paymentStatus:'APPROVED'}
  const original = structuredClone(approved)
  cleanup(approved)
  assert.deepEqual(cart.items,[])
  assert.equal(clears,1)
  assert.deepEqual(approved,original)
  cart = cartReducer(cart, {type:'ADD_ITEM',payload:product})
  cleanup({...approved})
  assert.equal(clears,1)
  assert.equal(cart.items.length,1)
  cleanup({...approved,id:'another-order'})
  assert.equal(clears,2)
  assert.deepEqual(cart.items,[])
})

test('CLEAR_CART no muta el snapshot original y conserva las operaciones del carrito', () => {
  const before = {items:[{...product}]}
  const cleared = cartReducer(before,{type:'CLEAR_CART'})
  assert.deepEqual(before.items,[product])
  assert.deepEqual(cleared,{items:[]})
  assert.equal(cartReducer(cleared,{type:'CLEAR_CART'}),cleared)
  const added = cartReducer(cleared,{type:'ADD_ITEM',payload:product})
  assert.equal(added.items[0].quantity,1)
  assert.equal(cartReducer(added,{type:'INCREMENT_ITEM',payload:{productId:product.productId}}).items[0].quantity,2)
})

test('el carrito vacío se persiste y no restaura productos anteriores al recargar', () => {
  const originalWindow = globalThis.window
  const storage = new Map()
  globalThis.window = {localStorage:{setItem:(key,value) => storage.set(key,value), getItem:key => storage.get(key) ?? null}}
  try {
    saveCart({items:[product]})
    assert.equal(loadCart({items:[]}).items.length,1)
    saveCart(cartReducer({items:[product]},{type:'CLEAR_CART'}))
    assert.deepEqual(JSON.parse(storage.get(CART_STORAGE_KEY)),{items:[]})
    assert.deepEqual(loadCart({items:[product]}),{items:[]})
  } finally { globalThis.window = originalWindow }
})
