/** Asegura que GET /api/products resuelva IDs existentes sin crear una ruta adicional. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from '../../client/node_modules/typescript/lib/typescript.js'

const dataUrl = source => 'data:text/javascript;base64,' + Buffer.from(source).toString('base64')
const servicesUrl = dataUrl(`
  globalThis.requestedIds = [];
  export async function getProductById(id) { globalThis.requestedIds.push(id); return id === 'missing' ? undefined : { objectID:id, title:'Actual ' + id }; }
  export async function getCatalogPage() { throw new Error('No debe consultar paginación en modo IDs'); }
  export async function searchProducts() { return []; }
`)
const mapperUrl = dataUrl('export function mapProductRecord(record) { return {id:record.objectID,name:record.title}; } export function mapSearchProductRecord(record) { return record; }')
const categoriesUrl = dataUrl('export async function getCategoryTree() { return []; }')
const source = readFileSync(new URL('../src/controllers/productController.ts', import.meta.url), 'utf8')
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ESNext } }).outputText
const js = compiled.replace(/from ['"]([^'"]+)['"]/g, (_match, dependency) => {
  const target = dependency.includes('productService') ? servicesUrl
    : dependency.includes('productMapper') ? mapperUrl : categoriesUrl
  return 'from ' + JSON.stringify(target)
})
const controller = await import(dataUrl(js))

function response() {
  return { body: undefined, statusCode: 200, status(code) { this.statusCode = code; return this }, json(body) { this.body = body; return this } }
}

test('resuelve IDs actuales, conserva su orden y omite productos eliminados', async () => {
  globalThis.requestedIds.length = 0
  const res = response()
  await controller.getProducts({ query: { ids: ['missing', 'p2', 'p2', 'p1'] } }, res, error => { throw error })
  assert.deepEqual(globalThis.requestedIds, ['missing', 'p2', 'p1'])
  assert.deepEqual(res.body.products, [{ id: 'p2', name: 'Actual p2' }, { id: 'p1', name: 'Actual p1' }])
  assert.equal(res.body.totalProducts, 2)
})

test('rechaza listas de IDs mayores al límite de historial', async () => {
  const res = response()
  await controller.getProducts({ query: { ids: Array.from({ length: 11 }, (_, index) => `p${index}`) } }, res, error => { throw error })
  assert.equal(res.statusCode, 400)
  assert.match(res.body.error, /10/)
})
