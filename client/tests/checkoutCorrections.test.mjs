import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

const dataUrl = source => 'data:text/javascript;base64,' + Buffer.from(source).toString('base64')
// Harness de handlers/estado; no sustituye las verificaciones DOM, foco o responsive.
const runtimeUrl = dataUrl(`
  let slots = [], cursor = 0;
  export let cart = [];
  export function reset(items) { slots = []; cursor = 0; cart = items; }
  export function renderStart() { cursor = 0; }
  export function useState(initial) {
    const index = cursor++;
    if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial;
    return [slots[index], value => { slots[index] = typeof value === 'function' ? value(slots[index]) : value; }];
  }
  export function useRef(initial) { const [value] = useState(() => ({current:initial})); return value; }
  export function useEffect() {}
  export function useCart() { return {items:cart, clearCart: () => { throw new Error('No se permite cleanup automático'); }}; }
  export const Fragment = 'Fragment';
  export function jsx(type, props) { return {type, props}; }
  export const jsxs = jsx;
`)
const runtime = await import(runtimeUrl)
const modules = new Map([
  ['react', runtimeUrl], ['react/jsx-runtime', runtimeUrl],
  ['../hooks/useCart', runtimeUrl],
])
for (const name of ['CheckoutStepper', 'BuyerStep', 'DeliveryStep', 'ReviewStep']) {
  modules.set('../components/checkout/' + name, dataUrl(`export default ${JSON.stringify(name)}`))
}
for (const name of ['Header', 'Footer']) modules.set('../components/layout/' + name, dataUrl(`export default ${JSON.stringify(name)}`))
function compile(file) {
  const source = readFileSync(new URL('../src/' + file, import.meta.url), 'utf8').replace('import.meta.env.VITE_API_BASE_URL', 'undefined')
  const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX } }).outputText
  return dataUrl(js.replace(/from ['"]([^'"]+)['"]/g, (_, dependency) => {
    const target = dependency.endsWith('.css') ? dataUrl('export default {}') : modules.get(dependency)
    assert.ok(target, 'Dependencia sin aislar: ' + dependency)
    return 'from ' + JSON.stringify(target)
  }))
}
const calculationsUrl = compile('utils/cartCalculations.ts')
modules.set('./cartCalculations', calculationsUrl)
modules.set('../utils/cartCalculations', calculationsUrl)
modules.set('../utils/checkoutValidation', compile('utils/checkoutValidation.ts'))
const differencesUrl = compile('utils/orderReviewDifferences.ts')
modules.set('../utils/orderReviewDifferences', differencesUrl)
const apiUrl = compile('services/orderApi.ts')
modules.set('../services/orderApi', apiUrl)
const { default: CheckoutPage } = await import(compile('pages/CheckoutPage.tsx'))
const { default: ReviewStep } = await import(compile('components/checkout/ReviewStep.tsx'))
const { orderReviewDifferences } = await import(differencesUrl)
const { calculateCartTotals } = await import(calculationsUrl)
const buyer = { fullName: 'Prueba', email: 'test@example.com', phone: '88888888' }
const delivery = { province: 'San José', canton: 'Central', address: 'Dirección' }
const cart = [{ productId: 'p', name: 'Producto', image: '', price: 10000, quantity: 1 }]
function order() {
  return { id:'order-1', orderNumber:'CN-1', createdAt:'2026-10-12T00:00:00Z', buyer, delivery,
    items:[{productId:'p', name:'Producto', image:'', unitPrice:10000, quantity:1, lineSubtotal:10000}],
    totals:calculateCartTotals(cart), currency:'CRC', orderStatus:'PENDING', paymentStatus:'PENDING' }
}
function nodes(tree) {
  if (Array.isArray(tree)) return tree.flatMap(nodes)
  if (!tree || typeof tree !== 'object') return []
  return [tree, ...nodes(tree.props?.children)]
}
function text(tree) {
  if (Array.isArray(tree)) return tree.map(text).join(' ')
  if (tree && typeof tree === 'object') return text(tree.props?.children)
  return typeof tree === 'string' ? tree : ''
}
function checkout() {
  runtime.reset(structuredClone(cart))
  const events = []
  const props = { onBackToCart: () => events.push('exit'), onCatalogClick: () => {}, onCartClick: () => {},
    onNavigationLockChange: busy => events.push(busy), onOrderCreated: () => events.push('created') }
  let tree
  const render = () => { runtime.renderStart(); tree = CheckoutPage(props) }
  const find = type => nodes(tree).find(node => node.type === type)?.props
  render()
  find('BuyerStep').onContinue(buyer)
  render()
  find('DeliveryStep').onContinue(delivery)
  render()
  return { render, review: () => find('ReviewStep'), step: () => find('CheckoutStepper').currentStep, events }
}
async function withFetch(responder, run) {
  const original = globalThis.fetch
  const requests = []
  globalThis.fetch = async (_, options) => {
    requests.push(JSON.parse(options.body))
    return responder(requests.length)
  }
  try { await run(requests) } finally { globalThis.fetch = original }
}

test('F4 igualdad exacta permite avance normal', async () => {
  assert.deepEqual(orderReviewDifferences(cart, order()), [])
  await withFetch(() => Response.json(order(), {status:201}), async requests => {
    const flow = checkout()
    await flow.review().onConfirm()
    flow.render()
    assert.equal(flow.step(), 'payment')
    assert.equal(requests.length, 1)
  })
})
for (const field of ['subtotal', 'tax', 'shipping', 'total']) {
  test('F4 detecta ' + field + ' sin redondeo visual', () => {
    const changed = order()
    changed.totals[field] += 0.001
    assert.equal(orderReviewDifferences(cart, changed).length, 1)
  })
}
test('F4 identifica precios, cantidades, líneas y productos añadidos/retirados', () => {
  for (const field of ['unitPrice', 'lineSubtotal', 'quantity']) {
    const changed = order()
    changed.items[0][field] += field === 'quantity' ? 1 : 0.001
    assert.equal(orderReviewDifferences(cart, changed).length, 1)
  }
  const changed = order()
  changed.items[0].productId = 'another'
  assert.equal(orderReviewDifferences(cart, changed).length, 2)
})
for (const field of ['total', 'tax', 'shipping', 'unitPrice']) {
  test('F4 ' + field + ' requiere aceptación y reutiliza la misma Order', async () => {
    const changed = order()
    if (field === 'unitPrice') changed.items[0].unitPrice += 0.001
    else changed.totals[field] += 0.001
    await withFetch(() => Response.json(changed, {status:201}), async requests => {
      const flow = checkout()
      await flow.review().onConfirm()
      flow.render()
      assert.equal(flow.step(), 'review')
      assert.ok(flow.review().differences.length)
      assert.equal(flow.review().onEdit, undefined)
      assert.deepEqual(flow.review().totals, changed.totals)
      assert.match(text(ReviewStep(flow.review())), /Aceptar cambios y continuar al pago/)
      assert.equal(flow.events.at(-1), true)
      const authoritative = flow.review().order
      await flow.review().onConfirm()
      flow.render()
      assert.equal(flow.step(), 'payment')
      assert.equal(flow.review().order, authoritative)
      assert.equal(requests.length, 1)
      assert.equal(flow.events.at(-1), false)
    })
  })
}
test('F4 compara Shipping redondeado y detecta un envío autoritativo diferente', () => {
  const below = [{ ...cart[0], price:99999.995 }]
  const changed = order()
  changed.items[0] = { ...changed.items[0], unitPrice:99999.995, lineSubtotal:99999.995 }
  changed.totals = calculateCartTotals(below)
  assert.equal(changed.totals.shipping, 0)
  assert.deepEqual(orderReviewDifferences(below, changed), [])
  changed.totals.shipping = 3500
  assert.match(orderReviewDifferences(below, changed)[0], /Envío/)
})

test('F4 IVA alineado con Server no produce diferencias artificiales ni exige aceptación', async () => {
  const fractional = [{...cart[0], price:99999.995}]
  // Snapshot explícito: no calcula los importes esperados mediante la utilidad Client.
  const authoritative = {
    ...order(),
    items:[{...order().items[0], unitPrice:99999.995, lineSubtotal:99999.995}],
    totals:{subtotal:99999.995, tax:13000, shipping:0, total:112999.995},
  }
  assert.deepEqual(orderReviewDifferences(fractional, authoritative), [])
  await withFetch(() => Response.json(authoritative, {status:201}), async requests => {
    const flow = checkout()
    runtime.cart[0].price = 99999.995
    flow.render()
    await flow.review().onConfirm()
    flow.render()
    assert.equal(flow.step(), 'payment')
    assert.deepEqual(flow.review().differences, [])
    assert.deepEqual(flow.review().totals, authoritative.totals)
    assert.equal(requests.length, 1)
  })
})
test('F4 salida advierte que la orden existe y conserva Cart', async () => {
  const changed = order()
  changed.totals.total++
  await withFetch(() => Response.json(changed, {status:201}), async requests => {
    const flow = checkout()
    await flow.review().onConfirm()
    flow.render()
    assert.match(text(ReviewStep(flow.review())), /La orden pendiente ya existe/)
    flow.review().onAbandon()
    assert.deepEqual(flow.events.slice(-2), [false, 'exit'])
    assert.equal(requests.length, 1)
    assert.deepEqual(runtime.cart, cart)
  })
})
test('F5 errores persistentes preservan key/payload/datos y ofrecen salida explícita', async () => {
  await withFetch(() => { throw new TypeError('simulated network failure') }, async requests => {
    const flow = checkout()
    await flow.review().onConfirm()
    flow.render()
    const first = structuredClone(requests[0])
    assert.equal(flow.step(), 'review')
    assert.equal(flow.review().retryPending, true)
    assert.deepEqual(flow.review().buyer, buyer)
    assert.deepEqual(flow.review().delivery, delivery)
    flow.review().onEdit('buyer')
    flow.render()
    assert.equal(flow.step(), 'review')
    await flow.review().onConfirm()
    flow.render()
    assert.deepEqual(requests[1], first)
    const message = text(ReviewStep(flow.review()))
    assert.match(message, /La orden podría haberse creado/)
    assert.match(message, /podrías crear una orden duplicada/)
    flow.review().onAbandon()
    assert.deepEqual(flow.events.slice(-2), [false, 'exit'])
    assert.equal(requests.length, 2)
    assert.deepEqual(runtime.cart, cart)
  })
})
test('F5 retry resuelto conserva identidad y compara el intento original, no Cart actualizado', async () => {
  await withFetch(count => {
    if (count === 1) throw new TypeError('simulated timeout')
    return Response.json(order(), {status:201})
  }, async requests => {
    const flow = checkout()
    await flow.review().onConfirm()
    flow.render()
    runtime.cart[0].price = 50000
    await flow.review().onConfirm()
    flow.render()
    assert.deepEqual(requests[1], requests[0])
    assert.equal(flow.step(), 'payment')
    assert.equal(flow.review().totals.total, order().totals.total)
  })
})
for (const paymentStatus of ['PENDING', 'DECLINED', 'ERROR']) {
  test('Replay pendiente ' + paymentStatus + ' conserva Order y Cart', async () => {
    await withFetch(() => Response.json({...order(), paymentStatus}, {status:201}), async requests => {
      const flow = checkout()
      await flow.review().onConfirm()
      flow.render()
      assert.equal(flow.step(), 'payment')
      assert.equal(flow.review().order.paymentStatus, paymentStatus)
      assert.equal(requests.length, 1)
      assert.deepEqual(runtime.cart, cart)
      if (paymentStatus !== 'PENDING') assert.match(text(ReviewStep(flow.review())), /último intento de pago/)
    })
  })
}
for (const changed of [false, true]) {
  test('Replay confirmado tras retry, diferencias=' + changed + ': sin Pago ni cleanup', async () => {
    const confirmed = {...order(), orderStatus:'CONFIRMED', paymentStatus:'APPROVED'}
    if (changed) confirmed.totals.total += 500
    await withFetch(count => {
      if (count === 1) throw new TypeError('simulated timeout')
      return Response.json(confirmed, {status:201})
    }, async requests => {
      const flow = checkout()
      await flow.review().onConfirm()
      flow.render()
      assert.equal(flow.review().retryPending, true)
      await flow.review().onConfirm()
      flow.render()
      assert.deepEqual(requests[1], requests[0])
      assert.equal(flow.step(), 'review')
      assert.equal(flow.review().retryPending, false)
      assert.equal(flow.review().error, undefined)
      assert.equal(flow.review().onConfirm, undefined)
      assert.equal(flow.review().onEdit, undefined)
      assert.deepEqual(flow.review().differences, [])
      assert.deepEqual(flow.review().order, confirmed)
      const message = text(ReviewStep(flow.review()))
      assert.match(message, /ya está confirmada y su pago fue aprobado/)
      assert.doesNotMatch(message, /Aceptar cambios|continuar al pago|orden pendiente|Reintentar/)
      assert.deepEqual(runtime.cart, cart)
      flow.review().onAbandon()
      assert.deepEqual(flow.events.slice(-2), [false, 'exit'])
      assert.equal(requests.length, 2)
      assert.deepEqual(runtime.cart, cart)
    })
  })
}
