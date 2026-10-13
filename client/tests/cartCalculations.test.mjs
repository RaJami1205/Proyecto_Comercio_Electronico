import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

const source = readFileSync(new URL('../src/utils/cartCalculations.ts', import.meta.url), 'utf8')
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ESNext } }).outputText
const { calculateCartTotals, calculateLineSubtotal } = await import('data:text/javascript;base64,' + Buffer.from(compiled).toString('base64'))
const item = (price, quantity = 1) => ({ productId: String(price), name: 'Producto', image: '', price, quantity })

// Mismos vectores explícitos del Server; sin importar código entre aplicaciones.
for (const [prices, shipping, tax] of [
  [[0], 0, 0], [[50000], 3500, 6500], [[99999], 3500, 12999.87], [[99999.01], 3500, 12999.87],
  [[99999.49], 3500, 12999.93], [[99999.50], 0, 12999.94], [[99999.99], 0, 13000],
  [[99999.995], 0, 13000], [[99999.999999], 0, 13000], [[100000], 0, 13000], [[100000.01], 0, 13000], [[150000], 0, 19500],
  [[60000, 39999.49], 3500, 12999.93], [[60000, 39999.50], 0, 12999.94], [[49999.49, 50000.49], 0, 13000],
  [[60000, 39999.995], 0, 13000], [[60000, 40000], 0, 13000],
]) {
  test('Shipping de la suma completa ' + prices.join(' + '), () => {
    const items = prices.map(price => item(price))
    const before = structuredClone(items)
    const totals = calculateCartTotals(items)
    const rawSubtotal = prices.reduce((sum, price) => sum + price, 0)
    assert.equal(totals.subtotal, rawSubtotal)
    assert.equal(totals.shipping, shipping)
    assert.equal(totals.tax, tax)
    assert.equal(totals.total, rawSubtotal + tax + shipping)
    assert.deepEqual(items, before)
  })
}

test('cantidades conservan precio y línea originales antes de determinar Shipping', () => {
  const price = 49999.9975
  assert.equal(calculateLineSubtotal(price, 2), 99999.995)
  const totals = calculateCartTotals([item(price, 2)])
  assert.equal(totals.subtotal, 99999.995)
  assert.equal(totals.shipping, 0)
  assert.equal(totals.tax, 13000)
  assert.equal(totals.total, 112999.995)
})

test('IVA fraccionario redondea a centavos sin redondear líneas ni total', () => {
  assert.deepEqual(calculateCartTotals([item(0.1), item(0.2)]), {
    subtotal: 0.1 + 0.2, tax: 0.04, shipping: 3500, total: 3500.34,
  })
  assert.deepEqual(calculateCartTotals([item(1.234)]), {
    subtotal: 1.234, tax: 0.16, shipping: 3500, total: 3501.394,
  })
})

test('carrito vacío mantiene todos los importes en cero', () => {
  assert.deepEqual(calculateCartTotals([]), {subtotal:0, tax:0, shipping:0, total:0})
})
