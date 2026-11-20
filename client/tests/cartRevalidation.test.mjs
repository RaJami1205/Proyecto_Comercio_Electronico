/** CartSection + Product API reales; render/commit controlados y todas las respuestas HTTP simuladas. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { dataUrl } from './helpers/analyticsHarness.mjs'
import { reactHarness, nodes, label } from './helpers/reactHarness.mjs'

const tick = () => new Promise(resolve => setImmediate(resolve))
const deferred = () => {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
const ids = count => Array.from({ length: count }, (_, index) => 'p' + String(index + 1).padStart(2, '0'))
const line = (id, index = 0) => ({ productId: id, name: 'Producto ' + id, image: '', price: 1,
  quantity: index % 2 + 1, lineage: { id: 'lineage-' + id, removed: 0 } })
const product = (id, { branch = 'san_jose', user = 'buyer-a', ...patch } = {}) => ({
  id, name: 'Producto ' + id, image: '', price: user === 'buyer-b' ? 2000.125 : 1000.125,
  retailPrice: 1000.125, pricing: { type: 'RETAIL', eligible: true, minOrderQuantity: 1, message: null },
  inventory: { branchId: branch, quantity: 50, status: 'available', canFulfillMinimum: true, message: 'Stock vigente en ' + branch },
  canAddToCart: true, inStock: true, category: 'Almacenamiento', description: '', specifications: [], ...patch,
})
const checkout = tree => nodes(tree).find(node => node.type === 'button' && label(node) === 'Finalizar compra').props
let instance = 0

async function flow(t, initial = ids(11).map(line)) {
  const h = await reactHarness()
  t.after(() => h.runtime.dispose())
  const branchUrl = dataUrl(`let selected='san_jose'; export function setBranch(value){selected=value;}
    export function useBranch(){return {selectedBranchId:selected};}`) + '#cart-' + instance++
  h.overrides.set('hooks/useBranch', branchUrl)
  const branch = await import(branchUrl)
  const { default: Cart } = await h.load('components/cart/CartSection')
  const api = await h.load('services/productApi')
  const calls = [], updates = []
  let items = structuredClone(initial), ownerId = 'buyer-a', active = true, purchases = 0
  let respond = call => Response.json({ products: call.ids.slice().reverse().map(id => product(id, call)) })
  const updateProductContext = (id, context) => {
    updates.push({ id, context })
    items = items.map(item => item.productId === id ? { ...item, ...context } : item)
    sync()
  }
  function sync() {
    h.runtime.setCart({ items, ownerId, isActive: active, totalUnits: items.reduce((sum, item) => sum + item.quantity, 0),
      hasExternalConflict: false, hasInvalidStorage: false, updateProductContext,
      incrementItem() {}, decrementItem() {}, removeItem() {} })
  }
  t.mock.method(globalThis, 'fetch', async (url, options = {}) => {
    const request = new URL(String(url), 'http://local.test')
    assert.equal(request.pathname, '/api/products', 'Solo el endpoint simulado de productos.')
    const call = { ids: request.searchParams.getAll('ids'), user: options.headers?.['X-CiberNova-User-Id'], branch: request.searchParams.get('branchId') }
    assert.ok(call.ids.length <= 10, 'Cada consulta respeta el contrato público de diez IDs.')
    calls.push(call)
    return respond(call)
  })
  h.runtime.setUser({ id: ownerId, role: 'B2C' })
  sync()
  const props = { onContinueShopping() {}, onCheckoutRequested() { purchases++ }, onProductSelect() {} }
  const render = () => h.render('cart', Cart, props)
  return { ...h, api, calls, updates, render, get items() { return items }, get purchases() { return purchases },
    respond(callback) { respond = callback },
    async settle() { await tick(); return render() },
    setItems(value) { items = structuredClone(value); sync(); return render() },
    setUser(id, role = 'B2C') { ownerId = id; h.runtime.setUser(id ? { id, role } : null); sync(); return render() },
    setBranch(id) { branch.setBranch(id); return render() },
    deactivate() { active = false; sync(); return render() },
  }
}

for (const count of [1, 10, 11, 20, 21]) {
  test('Cart revalida todos los productos en lotes: ' + count, async t => {
    const original = ids(count).map(line), f = await flow(t, original)
    assert.equal(checkout(f.render()).disabled, true)
    const tree = await f.settle()
    assert.equal(f.calls.length, Math.ceil(count / 10))
    assert.deepEqual(f.calls.flatMap(call => call.ids), ids(count))
    assert.ok(f.calls.every(call => call.user === 'buyer-a' && call.branch === 'san_jose'))
    assert.equal(f.updates.length, count)
    assert.equal(checkout(tree).disabled, false)
    checkout(tree).onClick()
    assert.equal(f.purchases, 1)
    assert.deepEqual(f.items.map(({ productId, quantity, lineage }) => ({ productId, quantity, lineage })),
      original.map(({ productId, quantity, lineage }) => ({ productId, quantity, lineage })))
    assert.ok(f.items.every(item => item.price === 1000.125))
    await f.settle()
    assert.equal(f.calls.length, Math.ceil(count / 10), 'Actualizar el contexto de las líneas no repite los lotes.')
  })
}

test('espera todos los lotes, acepta respuestas desordenadas y no publica resultados parciales', async t => {
  const f = await flow(t, ids(21).map(line)), pending = []
  f.respond(call => { const gate = deferred(); pending.push({ ...gate, call }); return gate.promise })
  f.render()
  for (const part of [pending[1], pending[0]]) part.resolve(Response.json({ products: part.call.ids.slice().reverse().map(id => product(id)) }))
  assert.equal(checkout(await f.settle()).disabled, true)
  assert.equal(f.updates.length, 0)
  pending[2].resolve(Response.json({ products: pending[2].call.ids.map(id => product(id)) }))
  assert.equal(checkout(await f.settle()).disabled, false)
  assert.equal(f.updates.length, 21)
  assert.equal(f.calls.length, 3)
})

test('deduplica consultas, conserva líneas/cantidades y no refetch por orden, cantidades o precios', async t => {
  const original = [...ids(11).map(line), { ...line('p01'), quantity: 7 }], f = await flow(t, original)
  f.render(); await f.settle()
  assert.deepEqual(f.calls.flatMap(call => call.ids), ids(11))
  assert.equal(f.items.length, original.length)
  assert.deepEqual(f.items.map(item => item.quantity), original.map(item => item.quantity))
  f.setItems(f.items.slice().reverse().map(item => ({ ...item, quantity: item.quantity + 1 })))
  await f.settle()
  assert.equal(f.calls.length, 2)
})

test('productos inexistentes conservan sus líneas y bloquean Checkout sin usar precios locales', async t => {
  const f = await flow(t)
  f.respond(call => Response.json({ products: call.ids.filter(id => id !== 'p11').map(id => product(id)) }))
  f.render()
  const tree = await f.settle()
  assert.equal(checkout(tree).disabled, true)
  assert.equal(f.items.length, 11)
  assert.equal(f.items.find(item => item.productId === 'p11').price, 1)
  assert.match(label(tree), /sin un precio comercial vigente/)
})

for (const [name, patch] of [
  ['sin precio', { price: null, pricing: { type: null, eligible: false, minOrderQuantity: null, message: 'Precio no disponible' } }],
  ['sin stock', { inventory: { branchId: 'san_jose', quantity: 0, status: 'out-of-stock', canFulfillMinimum: false, message: 'Sin stock' } }],
  ['MOQ incumplido', { pricing: { type: 'RETAIL', eligible: true, minOrderQuantity: 3, message: null } }],
  ['stock insuficiente', { inventory: { branchId: 'san_jose', quantity: 1, status: 'available', canFulfillMinimum: true, message: 'Solo una unidad' } }],
]) {
  test('conflicto comercial en el último lote impide Checkout: ' + name, async t => {
    const f = await flow(t, ids(11).map(id => ({ ...line(id), quantity: 2 })))
    f.respond(call => Response.json({ products: call.ids.map(id => product(id, id === 'p11' ? patch : {})) }))
    f.render()
    assert.equal(checkout(await f.settle()).disabled, true)
    assert.equal(f.items.length, 11)
  })
}

test('un fallo parcial invalida la revalidación completa sin borrar líneas ni aplicar lotes sueltos', async t => {
  const original = ids(21).map(line), f = await flow(t, original)
  f.respond(call => call.ids.includes('p11') ? Response.json({ error: 'No disponible' }, { status: 503 })
    : Response.json({ products: call.ids.map(id => product(id)) }))
  f.render()
  const tree = await f.settle()
  assert.equal(checkout(tree).disabled, true)
  assert.match(label(tree), /No pudimos actualizar precios y existencias/)
  assert.deepEqual(f.items, original)
  assert.equal(f.updates.length, 0)
  await f.settle()
  assert.equal(f.calls.length, 3)
  f.respond(call => Response.json({ products: call.ids.map(id => product(id, call)) }))
  f.setBranch('alajuela')
  assert.equal(checkout(await f.settle()).disabled, false)
})

for (const change of ['usuario', 'sucursal', 'epoch de la misma identidad']) {
  test('descarta todos los lotes antiguos tras cambiar ' + change, async t => {
    const f = await flow(t), old = []
    f.respond(call => { const gate = deferred(); old.push({ ...gate, call }); return gate.promise })
    f.render()
    f.respond(call => Response.json({ products: call.ids.map(id => product(id, { ...call, price: 3000.125 })) }))
    const loading = change === 'sucursal' ? f.setBranch('alajuela') : f.setUser(change === 'usuario' ? 'buyer-b' : 'buyer-a')
    assert.equal(checkout(loading).disabled, true)
    assert.equal(checkout(await f.settle()).disabled, false)
    const accepted = structuredClone(f.updates)
    for (const part of old) part.resolve(Response.json({ products: part.call.ids.map(id => product(id, { ...part.call, price: 9 })) }))
    assert.equal(checkout(await f.settle()).disabled, false)
    assert.deepEqual(f.updates, accepted)
    assert.ok(f.items.every(item => item.price === 3000.125))
    assert.ok(f.items.every(item => item.branchId === (change === 'sucursal' ? 'alajuela' : 'san_jose')))
    assert.equal(f.calls.length, 4)
  })
}

test('un fallo antiguo no invalida resultados de la nueva sucursal', async t => {
  const f = await flow(t), old = []
  f.respond(() => { const gate = deferred(); old.push(gate); return gate.promise })
  f.render()
  f.respond(call => Response.json({ products: call.ids.map(id => product(id, call)) }))
  f.setBranch('alajuela'); await f.settle()
  old[0].reject(new Error('Fallo del contexto anterior'))
  old[1].resolve(Response.json({ products: [] }))
  assert.equal(checkout(await f.settle()).disabled, false)
  assert.equal(f.updates.length, 11)
})

test('volver a la sucursal inicial exige lotes nuevos y descarta el contexto intermedio', async t => {
  const f = await flow(t), pending = []
  f.render(); await f.settle()
  f.respond(call => { const gate = deferred(); pending.push({ ...gate, call }); return gate.promise })
  f.setBranch('alajuela')
  assert.equal(checkout(f.setBranch('san_jose')).disabled, true)
  for (const part of pending.filter(part => part.call.branch === 'san_jose')) {
    part.resolve(Response.json({ products: part.call.ids.map(id => product(id, { ...part.call, price: 6000.125 })) }))
  }
  assert.equal(checkout(await f.settle()).disabled, false)
  for (const part of pending.filter(part => part.call.branch === 'alajuela')) {
    part.resolve(Response.json({ products: part.call.ids.map(id => product(id, { ...part.call, price: 9 })) }))
  }
  await f.settle()
  assert.ok(f.items.every(item => item.price === 6000.125 && item.branchId === 'san_jose'))
  assert.equal(f.calls.length, 6)
})

for (const state of ['inactivo', 'desmontado']) {
  test('un Cart ' + state + ' no aplica respuestas pendientes', async t => {
    const f = await flow(t), pending = []
    f.respond(call => { const gate = deferred(); pending.push({ ...gate, call }); return gate.promise })
    f.render()
    if (state === 'inactivo') f.deactivate()
    else f.runtime.unmount('cart')
    for (const part of pending) part.resolve(Response.json({ products: part.call.ids.map(id => product(id)) }))
    await tick()
    if (state === 'inactivo') assert.match(label(f.render()), /Carrito guardado/)
    assert.equal(f.updates.length, 0)
    assert.equal(f.calls.length, 2)
  })
}

test('el Cart vacío no consulta productos y Recently Viewed sigue limitado a diez IDs', async t => {
  const f = await flow(t, [])
  f.render(); await f.settle()
  assert.equal(f.calls.length, 0)
  const history = await f.api.getProductsByIds(ids(21), 'buyer-a', 'san_jose')
  assert.equal(history.length, 10)
  assert.deepEqual(f.calls[0].ids, ids(10))
})

test('el Cart B2B conserva Wholesale/MOQ y habilita Checkout con contexto comercial válido', async t => {
  const f = await flow(t, ids(11).map(id => ({ ...line(id), quantity: 3 })))
  f.respond(call => Response.json({ products: call.ids.map(id => product(id, { ...call, price: 800.125,
    pricing: { type: 'WHOLESALE', eligible: true, minOrderQuantity: 3, message: null } })) }))
  f.setUser('business', 'B2B')
  const tree = await f.settle()
  assert.ok(f.items.every(item => item.price === 800.125 && item.minimumOrderQuantity === 3))
  assert.match(label(tree), /Precios B2B/)
  assert.equal(checkout(tree).disabled, false)
})

test('el Cart B2B bloquea Checkout cuando una cantidad queda bajo el MOQ', async t => {
  const f = await flow(t, [{ ...line('p1'), quantity: 2 }])
  f.respond(call => Response.json({ products: call.ids.map(id => product(id, { ...call, price: 800,
    pricing: { type: 'WHOLESALE', eligible: true, minOrderQuantity: 3, message: null } })) }))
  f.setUser('business', 'B2B')
  const tree = await f.settle()
  assert.equal(checkout(tree).disabled, true)
})
