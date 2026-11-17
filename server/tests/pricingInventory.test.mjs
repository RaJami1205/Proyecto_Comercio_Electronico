import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from '../../client/node_modules/typescript/lib/typescript.js'

const dataUrl = source => 'data:text/javascript;base64,' + Buffer.from(source).toString('base64')
const compile = path => ts.transpileModule(readFileSync(new URL('../src/' + path, import.meta.url), 'utf8'),
  { compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ESNext } }).outputText
const branch = await import(dataUrl(compile('services/branchService.ts').replace("from '../domain/catalogError.js'", `from ${JSON.stringify(dataUrl(compile('domain/catalogError.ts')))}`)))
const pricing = await import(dataUrl(compile('domain/pricing.ts')))
const inventory = await import(dataUrl(compile('domain/inventory.ts').replace("from './catalogError.js'", `from ${JSON.stringify(dataUrl(compile('domain/catalogError.ts')))}`).replace("from '../services/branchService.js'", `from ${JSON.stringify(dataUrl(compile('services/branchService.ts').replace("from '../domain/catalogError.js'", `from ${JSON.stringify(dataUrl(compile('domain/catalogError.ts')))}`)))}`)))
const errorUrl = dataUrl(compile('domain/catalogError.ts'))
const branchUrl = dataUrl(compile('services/branchService.ts').replace("from '../domain/catalogError.js'", `from ${JSON.stringify(errorUrl)}`))
const inventoryUrl = dataUrl(compile('domain/inventory.ts').replace("from './catalogError.js'", `from ${JSON.stringify(errorUrl)}`).replace("from '../services/branchService.js'", `from ${JSON.stringify(branchUrl)}`))
const mapper = await import(dataUrl(compile('mappers/productMapper.ts').replace("from '../domain/pricing.js'", `from ${JSON.stringify(dataUrl(compile('domain/pricing.ts')))}`).replace("from '../domain/inventory.js'", `from ${JSON.stringify(inventoryUrl)}`)))

const product = overrides => ({ objectID:'p1', title:'Producto', price:1000, in_stock:true, b2b:{available:true,wholesale_price:800,min_order_quantity:3}, stock_by_branch:{san_jose:5,alajuela:0,cartago:2,heredia:1}, ...overrides })

test('pricing conserva Retail, aplica Wholesale solo a B2B y deja Admin en solo lectura', () => {
  assert.deepEqual(pricing.resolvePricing(product(), null), {type:'RETAIL',price:1000,retailPrice:1000,eligible:true,minOrderQuantity:1,issue:null})
  assert.equal(pricing.resolvePricing(product(), 'B2B').price, 800)
  assert.equal(pricing.resolvePricing(product(), 'ADMIN').eligible, false)
  assert.equal(pricing.resolvePricing(product(), 'ADMIN').price, 1000)
})

test('pricing B2B no usa fallback retail si hay datos faltantes o inválidos', () => {
  assert.equal(pricing.resolvePricing(product({b2b:{available:false}}), 'B2B').price, null)
  assert.equal(pricing.resolvePricing(product({b2b:{available:true,wholesale_price:0,min_order_quantity:1.5}}), 'B2B').issue, 'INVALID_MOQ')
  assert.equal(pricing.resolvePricing(product({b2b:{available:true,wholesale_price:Infinity,min_order_quantity:2}}), 'B2B').price, null)
  assert.equal(pricing.resolvePricing(product({price:-1}), 'B2C').price, null)
})

test('MOQ se valida con límites enteros y el valor mínimo exacto', () => {
  const resolved = pricing.resolvePricing(product(), 'B2B')
  assert.equal(pricing.validateCommercialQuantity(resolved, 2).code, 'INVALID_MOQ')
  assert.equal(pricing.validateCommercialQuantity(resolved, 3).valid, true)
  assert.equal(pricing.validateCommercialQuantity(resolved, 3.5).code, 'INVALID_QUANTITY')
})

test('sucursales tienen IDs estables; inventario no usa stock total como fallback', () => {
  assert.deepEqual(branch.getBranches().map(item=>item.id), ['san_jose','alajuela','cartago','heredia'])
  assert.equal(inventory.getBranchInventory(product(), null).status, 'unselected')
  assert.equal(inventory.getBranchInventory(product(), 'san_jose').quantity, 5)
  assert.equal(inventory.getBranchInventory(product(), 'alajuela').status, 'out-of-stock')
  assert.equal(inventory.getBranchInventory(product({stock_by_branch:{}}), 'cartago').status, 'invalid')
})

test('inventario acepta límites disponibles y rechaza mínimo, exceso o sucursal inválida', () => {
  assert.equal(inventory.validateBranchQuantity(product(), 'san_jose', 5, 3).availableQuantity, 5)
  for (const [branchId, quantity, code] of [['san_jose',2,'INVALID_QUANTITY'],['san_jose',6,'INSUFFICIENT_INVENTORY'],['bogus',1,'INVALID_BRANCH_ID']]) {
    assert.throws(() => inventory.validateBranchQuantity(product(), branchId, quantity, 3), error => error.code === code)
  }
})

test('DTO presenta precios y stock según identidad y sucursal, sin habilitar B2B bajo MOQ', () => {
  const b2c = mapper.mapProductRecord(product(), {id:'retail',displayName:'Retail',role:'B2C'}, null)
  assert.equal(b2c.price, 1000)
  assert.equal(b2c.canAddToCart, true)
  const b2b = mapper.mapProductRecord(product(), {id:'wholesale',displayName:'Mayorista',role:'B2B',company:{id:'co',name:'Empresa'}}, 'san_jose')
  assert.equal(b2b.price, 800)
  assert.equal(b2b.inventory.quantity, 5)
  assert.equal(b2b.canAddToCart, false)
  const b2bUnavailable = mapper.mapProductRecord(product(), {id:'wholesale',displayName:'Mayorista',role:'B2B',company:{id:'co',name:'Empresa'}}, 'alajuela')
  assert.equal(b2bUnavailable.inventory.status, 'out-of-stock')
  const admin = mapper.mapProductRecord(product(), {id:'admin',displayName:'Admin',role:'ADMIN'}, 'san_jose')
  assert.equal(admin.canAddToCart, false)
})
