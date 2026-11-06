/** Verifica que el historial consulta los DTOs actuales del catálogo con IDs codificados. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

const source = readFileSync(new URL('../src/services/productApi.ts', import.meta.url), 'utf8').replace('import.meta.env.VITE_API_BASE_URL', 'undefined')
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ESNext } }).outputText
const productApi = await import('data:text/javascript;base64,' + Buffer.from(compiled).toString('base64'))

test('resuelve hasta diez IDs en orden y no solicita datos si el historial está vacío', async t => {
  const calls = []
  t.mock.method(globalThis, 'fetch', async url => {
    calls.push(String(url))
    return Response.json({ products: [{ id: 'p/1', name: 'Producto actual' }] })
  })
  assert.deepEqual(await productApi.getProductsByIds([]), [])
  assert.equal(calls.length, 0)
  const result = await productApi.getProductsByIds(['p/1', 'p 2'])
  assert.deepEqual(result, [{ id: 'p/1', name: 'Producto actual' }])
  assert.match(calls[0], /^\/api\/products\?ids=p%2F1&ids=p\+2$/)
  assert.deepEqual(await productApi.getProductsByIds(Array.from({ length: 12 }, (_, index) => `p${index}`)), [{ id: 'p/1', name: 'Producto actual' }])
  assert.equal(new URL(calls[1], 'http://localhost').searchParams.getAll('ids').length, 10)
})
