/** CN-68 Inventory Simulation: validación, reducer en memoria, panel, Session, guards y aislamiento comercial. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dataUrl } from './helpers/analyticsHarness.mjs'
import { reactHarness, nodes } from './helpers/reactHarness.mjs'

const buyer = { id: 'buyer', displayName: 'Cliente', role: 'B2C' }
const business = { id: 'business', displayName: 'Compras', role: 'B2B', company: { id: 'co', name: 'Empresa ficticia' } }
const admin = { id: 'admin', displayName: 'Administración', role: 'ADMIN' }
const flush = () => new Promise(resolve => setImmediate(resolve))
const rawText = tree => Array.isArray(tree) ? tree.map(rawText).join(' ')
  : tree && typeof tree === 'object' ? rawText(tree.props?.children)
  : typeof tree === 'string' || typeof tree === 'number' ? String(tree) : ''
/** Texto visible con los espacios que JSX agrega entre expresiones normalizados. */
const textOf = tree => rawText(tree).replace(/\s+/g, ' ').replace(/\( /g, '(').replace(/ ([),])/g, '$1').trim()
const deep = tree => Array.isArray(tree) ? tree.map(deep)
  : tree && typeof tree === 'object' && typeof tree.type === 'function' ? deep(tree.type(tree.props))
  : tree && typeof tree === 'object' && tree.props ? { ...tree, props: { ...tree.props, children: deep(tree.props.children) } } : tree
/** Congela recursivamente para detectar cualquier mutación del DTO recibido del Server. */
const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value) } return value }

const branches = quantities => ['san_jose', 'alajuela', 'cartago', 'heredia'].map((branchId, index) => ({
  branchId, name: ['San José', 'Alajuela', 'Cartago', 'Heredia'][index], quantity: quantities[index],
  status: quantities[index] === null ? 'invalid' : quantities[index] === 0 ? 'out-of-stock' : quantities[index] < 3 ? 'below-moq' : 'available',
}))
const product = (id = 'ssd', quantities = [18, 2, 0, 8]) => freeze({
  id, sku: 'SKU-' + id, title: 'SSD ' + id, brand: 'Marca', categories: ['Almacenamiento'], image: null, currency: 'CRC',
  pricing: { retailPrice: 45000, wholesalePrice: 39000, b2bAvailable: true, minOrderQuantity: 3, b2bStatus: 'eligible' },
  inventory: { globalStock: 28, branchTotal: 28, availability: 'limited', insufficientForMoq: false, branches: branches(quantities) },
  issues: [],
})

async function load(t, user = admin) {
  const h = await reactHarness()
  t.after(() => h.runtime.dispose())
  h.runtime.setUser(user)
  h.runtime.setCart({ items: [], totalUnits: 0, hasExternalConflict: false })
  h.overrides.set('components/layout/Header', dataUrl('export default "Header"'))
  h.overrides.set('components/layout/Footer', dataUrl('export default "Footer"'))
  const sim = await h.load('utils/inventorySimulation')
  const { default: Panel } = await h.load('components/admin/InventorySimulationPanel')
  const { default: DetailPage } = await h.load('pages/AdminProductDetailPage')
  return { ...h, sim, Panel, DetailPage }
}

/** Monta el panel con un estado real de reducer, como lo hace App, y expone acciones de interacción. */
function panelHarness(h, item = product(), options = {}) {
  let state = h.sim.EMPTY_SIMULATION
  let ownerId = 'admin'
  const actions = []
  const dispatch = action => {
    actions.push(action)
    state = h.sim.inventorySimulationReducer(state, options.transformAction?.(action) ?? action)
  }
  const render = () => deep(h.render('panel', h.Panel, { product: item, ownerId, entries: h.sim.simulationsFor(state, ownerId, item.id), onSimulationChange: dispatch }))
  const find = (tree, predicate) => nodes(tree).find(predicate)
  const button = (tree, label) => find(tree, node => node.type === 'button' && textOf(node).trim() === label)
  return {
    actions, render, button, get state() { return state },
    setProduct(value) { item = value; return render() },
    setSession(user) {
      h.runtime.setUser(user)
      ownerId = user?.id ?? ''
      state = h.sim.inventorySimulationReducer(state, { type: 'reset-all' })
      return render()
    },
    selectBranch(id) { find(render(), node => node.type === 'select').props.onChange({ target: { value: id } }) },
    type(value) { find(render(), node => node.type === 'input').props.onChange({ target: { value } }) },
    review() { find(render(), node => node.type === 'form').props.onSubmit({ preventDefault() {} }) },
    click(label) { button(render(), label).props.onClick() },
  }
}

test('validación: enteros no negativos, cero válido y rechazo de vacíos, decimales, signos y excesos', async t => {
  const { sim } = await load(t)
  for (const [raw, value] of [['0', 0], ['25', 25], [' 7 ', 7], ['1000000', 1_000_000], ['1000001', 1_000_001],
    [String(Number.MAX_SAFE_INTEGER), Number.MAX_SAFE_INTEGER]]) assert.deepEqual(sim.validateSimulatedQuantity(raw), { ok: true, value })
  for (const [raw, message] of [['', /Ingresa una cantidad/], ['   ', /Ingresa una cantidad/], ['-3', /negativa/], ['2.5', /entero/],
    ['2,5', /entero/], ['abc', /solo dígitos/], ['1e3', /solo dígitos/], ['+4', /solo dígitos/], ['0x10', /solo dígitos/],
    ['NaN', /solo dígitos/], ['Infinity', /solo dígitos/], ['1 000', /solo dígitos/], [String(Number.MAX_SAFE_INTEGER + 1), /máxima/],
    ['99999999999999999999', /máxima/]]) {
    const result = sim.validateSimulatedQuantity(raw)
    assert.equal(result.ok, false, raw)
    assert.match(result.message, message, raw)
  }
})

test('original válido: más de un millón, convencional, cero y máximo seguro se aplican realmente antes de anunciar éxito', async t => {
  for (const original of [1_000_001, 18, 0, Number.MAX_SAFE_INTEGER]) {
    await t.test(String(original), async child => {
      const h = await load(child)
      const item = product('ssd', [original, 2, 0, 8])
      const snapshot = structuredClone(item)
      const p = panelHarness(h, item)
      p.selectBranch('san_jose'); p.type('25'); p.review()
      assert.deepEqual(p.actions, [])
      assert.equal(Object.keys(p.state.entries).length, 0)
      assert.doesNotMatch(textOf(p.render()), /Simulación aplicada/)
      p.click('Confirmar simulación')
      const entry = p.state.entries[h.sim.simulationKey('ssd', 'san_jose')]
      assert.deepEqual(entry, { productId: 'ssd', branchId: 'san_jose', originalQuantity: original, simulatedQuantity: 25, status: 'applied' })
      assert.match(textOf(p.render()), /Simulación aplicada/)
      assert.deepEqual(item, snapshot, 'El DTO congelado conserva todas sus referencias y valores originales')
    })
  }
})

test('original inválido: formulario y reducer rechazan desconocido, negativo, decimal, NaN, Infinity y cantidades inseguras', async t => {
  for (const original of [null, undefined, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    await t.test(String(original), async child => {
      const h = await load(child)
      const p = panelHarness(h, product('ssd', [original, 2, 0, 8]))
      p.selectBranch('san_jose'); p.type('25')
      assert.equal(p.button(p.render(), 'Revisar simulación').props.disabled, true)
      p.review()
      assert.equal(nodes(p.render()).some(node => node.props?.role === 'alertdialog'), false)
      assert.match(textOf(p.render()), /no está disponible/)
      assert.doesNotMatch(textOf(p.render()), /Simulación aplicada/)
      assert.deepEqual(p.actions, [])
      const state = h.sim.inventorySimulationReducer(h.sim.EMPTY_SIMULATION, { type: 'apply', ownerId: 'admin', productId: 'ssd',
        branchId: 'san_jose', originalQuantity: original, simulatedQuantity: 25 })
      assert.equal(Object.keys(state.entries).length, 0)
    })
  }
})

test('propuesta: cero, más de un millón y máximo seguro; valores inválidos no producen estado ni feedback de éxito', async t => {
  for (const [raw, value] of [['0', 0], ['1000001', 1_000_001], [String(Number.MAX_SAFE_INTEGER), Number.MAX_SAFE_INTEGER]]) {
    await t.test(raw, async child => {
      const h = await load(child)
      const p = panelHarness(h)
      p.selectBranch('san_jose'); p.type(raw); p.review(); p.click('Confirmar simulación')
      assert.equal(p.state.entries[h.sim.simulationKey('ssd', 'san_jose')].simulatedQuantity, value)
      const tree = p.render()
      assert.match(textOf(tree), /Simulación aplicada/)
      assert.equal(nodes(tree).find(node => node.type === 'input').props.maxLength, String(Number.MAX_SAFE_INTEGER).length)
    })
  }
  const h = await load(t)
  const p = panelHarness(h)
  p.selectBranch('san_jose')
  for (const raw of ['', '  ', '-1', '1.5', 'NaN', 'Infinity', 'no numérico', String(Number.MAX_SAFE_INTEGER + 1)]) {
    p.type(raw); p.review()
    assert.ok(nodes(p.render()).some(node => node.props?.id === 'simulation-error'))
    assert.equal(Object.keys(p.state.entries).length, 0)
    assert.doesNotMatch(textOf(p.render()), /Simulación aplicada/)
  }
  for (const simulatedQuantity of [-1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    const state = h.sim.inventorySimulationReducer(h.sim.EMPTY_SIMULATION, { type: 'apply', ownerId: 'admin', productId: 'ssd',
      branchId: 'san_jose', originalQuantity: 18, simulatedQuantity })
    assert.equal(Object.keys(state.entries).length, 0)
  }
})

test('confirmación rechazada por el reducer conserva el estado anterior y muestra error, incluso si ya existían los mismos valores', async t => {
  for (const previous of [false, true]) {
    await t.test(previous ? 'con entrada previa idéntica' : 'sin entrada previa', async child => {
      const h = await load(child)
      let reject = false
      const p = panelHarness(h, product(), { transformAction: action => reject ? { ...action, simulatedQuantity: NaN } : action })
      if (previous) {
        p.selectBranch('san_jose'); p.type('25'); p.review(); p.click('Confirmar simulación')
        assert.match(textOf(p.render()), /Simulación aplicada/)
      }
      const before = p.state
      reject = true
      p.selectBranch('san_jose'); p.type('25'); p.review(); p.click('Confirmar simulación')
      if (previous) assert.equal(p.state, before)
      assert.deepEqual(p.state.entries, before.entries)
      assert.match(textOf(p.render()), /No se pudo aplicar la simulación/)
      assert.doesNotMatch(textOf(p.render()), /Simulación aplicada/)
    })
  }
})

test('confirmación: cancelar, cambiar producto/sucursal o cambiar el original invalida la propuesta sin éxito falso', async t => {
  for (const change of ['cancelar', 'producto', 'sucursal', 'original']) {
    await t.test(change, async child => {
      const h = await load(child)
      const p = panelHarness(h)
      p.selectBranch('san_jose'); p.type('25')
      const select = nodes(p.render()).find(node => node.type === 'select')
      p.review()
      const confirm = p.button(p.render(), 'Confirmar simulación').props.onClick
      if (change === 'cancelar') p.click('Descartar cambio')
      else if (change === 'producto') p.setProduct(product('other'))
      else if (change === 'sucursal') select.props.onChange({ target: { value: 'heredia' } })
      else p.setProduct(product('ssd', [17, 2, 0, 8]))
      if (change === 'original') p.click('Confirmar simulación')
      else confirm() // Callback anterior a la invalidación: no debe poder aplicar nada.
      assert.equal(Object.keys(p.state.entries).length, 0)
      assert.deepEqual(p.actions, [])
      assert.doesNotMatch(textOf(p.render()), /Simulación aplicada/)
      if (change === 'original') assert.match(textOf(p.render()), /inventario original cambió/)
    })
  }
})

test('confirmación: cambio de identidad, nuevo epoch o Logout descartan propuestas y callbacks de la Session anterior', async t => {
  for (const user of [{ ...admin, id: 'admin-2' }, admin, null]) {
    await t.test(user?.id ?? 'Logout', async child => {
      const h = await load(child)
      const p = panelHarness(h)
      p.selectBranch('san_jose'); p.type('25'); p.review()
      const confirm = p.button(p.render(), 'Confirmar simulación').props.onClick
      p.setSession(user)
      confirm()
      assert.deepEqual(p.actions, [])
      assert.equal(Object.keys(p.state.entries).length, 0)
      assert.doesNotMatch(textOf(p.render()), /Simulación aplicada/)
      assert.equal(nodes(p.render()).some(node => node.props?.role === 'alertdialog'), false)
    })
  }
})

test('confirmación repetida aplica una sola vez; desmontar el panel invalida el callback restante', async t => {
  const h = await load(t)
  const p = panelHarness(h)
  p.selectBranch('san_jose'); p.type('25'); p.review()
  const confirm = p.button(p.render(), 'Confirmar simulación').props.onClick
  confirm(); confirm()
  assert.equal(p.actions.length, 1)
  assert.equal(Object.keys(p.state.entries).length, 1)
  assert.equal(p.state.entries[h.sim.simulationKey('ssd', 'san_jose')].simulatedQuantity, 25)
  assert.match(textOf(p.render()), /Simulación aplicada/)
  p.selectBranch('san_jose'); p.type('30'); p.review()
  const stale = p.button(p.render(), 'Confirmar simulación').props.onClick
  h.runtime.unmount('panel')
  stale()
  assert.equal(p.actions.length, 1)
  assert.equal(p.state.entries[h.sim.simulationKey('ssd', 'san_jose')].simulatedQuantity, 25)
})

test('reducer: incremento, reducción, cero, Reset y aislamiento por identidad sin mutar estados previos', async t => {
  const { sim } = await load(t)
  const empty = sim.EMPTY_SIMULATION
  const apply = (state, branchId, originalQuantity, simulatedQuantity, ownerId = 'admin', productId = 'ssd') =>
    sim.inventorySimulationReducer(state, { type: 'apply', ownerId, productId, branchId, originalQuantity, simulatedQuantity })
  let state = apply(empty, 'san_jose', 18, 25)
  const snapshot = structuredClone(state)
  state = apply(state, 'heredia', 8, 3)
  state = apply(state, 'alajuela', 2, 0)
  assert.deepEqual(snapshot, structuredClone(apply(empty, 'san_jose', 18, 25)), 'El estado anterior no cambia')
  assert.deepEqual(empty, { ownerId: null, entries: {} })
  const entries = sim.simulationsFor(state, 'admin', 'ssd')
  assert.deepEqual(entries.map(entry => [entry.branchId, entry.originalQuantity, entry.simulatedQuantity, sim.simulationChange(entry)]),
    [['san_jose', 18, 25, 'increase'], ['alajuela', 2, 0, 'decrease'], ['heredia', 8, 3, 'decrease']])
  assert.ok(entries.every(entry => entry.status === 'applied'))
  // Se rechazan datos inválidos sin crear simulaciones.
  for (const [branchId, original, simulated] of [['limon', 1, 1], ['cartago', null, 1], ['cartago', -1, 1], ['cartago', 1, 1.5], ['cartago', 1, -2]]) {
    assert.equal(sim.simulationsFor(apply(state, branchId, original, simulated), 'admin', 'ssd').length, 3)
  }
  state = sim.inventorySimulationReducer(state, { type: 'reset', ownerId: 'admin', productId: 'ssd', branchId: 'heredia' })
  assert.deepEqual(sim.simulationsFor(state, 'admin', 'ssd').map(entry => entry.branchId), ['san_jose', 'alajuela'])
  state = apply(state, 'cartago', 0, 4, 'admin', 'other')
  state = sim.inventorySimulationReducer(state, { type: 'reset-product', ownerId: 'admin', productId: 'ssd' })
  assert.deepEqual(sim.simulationsFor(state, 'admin', 'ssd'), [])
  assert.equal(sim.simulationsFor(state, 'admin', 'other').length, 1)
  // Otra identidad no hereda simulaciones y empieza desde cero.
  assert.deepEqual(sim.simulationsFor(state, 'admin-2', 'other'), [])
  const other = apply(state, 'san_jose', 18, 1, 'admin-2')
  assert.deepEqual(sim.simulationsFor(other, 'admin-2', 'other'), [])
  assert.deepEqual(Object.values(other.entries).map(entry => entry.productId), ['ssd'])
  assert.equal(sim.inventorySimulationReducer(state, { type: 'reset-all' }), sim.EMPTY_SIMULATION)
})

test('panel: selección de sucursal, cantidad original del Server, confirmación explícita y comparación', async t => {
  const h = await load(t)
  const item = product()
  const p = panelHarness(h, item)
  let tree = p.render()
  assert.match(textOf(tree), /Inventory Simulation · Modo demostrativo/)
  assert.match(textOf(tree), /No modifican Algolia, PostgreSQL/)
  assert.equal(p.button(tree, 'Revisar simulación').props.disabled, true, 'Sin sucursal no se puede revisar')
  p.selectBranch('san_jose')
  assert.match(textOf(p.render()), /Cantidad original \(Server\):\s+18 unidades/)
  p.type('25')
  p.review()
  tree = p.render()
  assert.deepEqual(p.actions, [], 'Revisar no aplica todavía')
  const confirmation = nodes(tree).find(node => node.props?.role === 'alertdialog')
  for (const expected of [/Producto\s+SSD ssd/, /Sucursal\s+San José/, /Original Stock \(Server\)\s+18 unidades/, /25 unidades\s+\(Incremento, \+7\)/, /exclusivamente simulada/]) {
    assert.match(textOf(confirmation), expected)
  }
  p.click('Confirmar simulación')
  assert.deepEqual(p.actions, [{ type: 'apply', ownerId: 'admin', productId: 'ssd', branchId: 'san_jose', originalQuantity: 18, simulatedQuantity: 25 }])
  tree = p.render()
  const feedback = textOf(nodes(tree).find(node => node.props?.role === 'status'))
  assert.match(feedback, /Simulación aplicada en San José: 18 unidades → 25 unidades \(\+7\)/)
  assert.match(feedback, /Algolia, PostgreSQL y el Server no se modificaron/)
  assert.doesNotMatch(feedback, /se actualizó|actualizado en Algolia|guardado/i)
  const comparison = textOf(nodes(tree).find(node => node.type === 'table'))
  assert.match(comparison, /Original Stock.*Simulated Stock/)
  assert.match(comparison, /San José\s+18 unidades\s+25 unidades · simulado\s+Incremento \(\+7\)/)
  assert.deepEqual(item.inventory.branches[0], { branchId: 'san_jose', name: 'San José', quantity: 18, status: 'available' }, 'El DTO no se modifica')
})

test('panel: reducción, cero como agotado, descartar pendiente y Reset por sucursal y producto', async t => {
  const h = await load(t)
  const p = panelHarness(h)
  p.selectBranch('heredia'); p.type('2'); p.review(); p.click('Confirmar simulación')
  p.selectBranch('alajuela'); p.type('0'); p.review(); p.click('Confirmar simulación')
  let comparison = textOf(nodes(p.render()).find(node => node.type === 'table'))
  assert.match(comparison, /Alajuela\s+2 unidades\s+0 unidades · simulado\s+Reducción \(-2\)/)
  assert.match(comparison, /Heredia\s+8 unidades\s+2 unidades · simulado\s+Reducción \(-6\)/)
  p.selectBranch('san_jose'); p.type('30'); p.review()
  p.click('Descartar cambio')
  assert.match(textOf(p.render()), /Se descartó la modificación pendiente/)
  assert.equal(p.state.entries[h.sim.simulationKey('ssd', 'san_jose')], undefined)
  nodes(p.render()).find(node => node.type === 'button' && node.props['aria-label'] === 'Restablecer Heredia al inventario original').props.onClick()
  assert.match(textOf(p.render()), /Simulación descartada en Heredia\. Se muestra nuevamente el inventario consultado/)
  assert.deepEqual(h.sim.simulationsFor(p.state, 'admin', 'ssd').map(entry => entry.branchId), ['alajuela'])
  p.click('Restablecer simulación del producto')
  const tree = p.render()
  assert.deepEqual(h.sim.simulationsFor(p.state, 'admin', 'ssd'), [])
  assert.equal(nodes(tree).some(node => node.type === 'table'), false, 'Sin simulaciones vuelve a la vista original')
})

test('Reset: descarta 18 → 25 y muestra el DTO consultado, tanto si mantiene 18 como si ahora devuelve 7', async t => {
  for (const quantity of [18, 7]) {
    await t.test('inventario consultado ' + quantity, async child => {
      const h = await load(child)
      const calls = deferredFetch(child)
      const { adminProductApi } = await h.load('services/adminProductApi')
      const { default: Table } = await h.load('components/admin/BranchInventoryTable')
      const original = product()
      const p = panelHarness(h, original)
      p.selectBranch('san_jose'); p.type('25'); p.review(); p.click('Confirmar simulación')
      const key = h.sim.simulationKey('ssd', 'san_jose')
      assert.equal(p.state.entries[key].originalQuantity, 18)
      assert.equal(p.state.entries[key].simulatedQuantity, 25)

      // Nueva consulta controlada: conserva la simulación, pero recibe el inventario vigente desde la API real.
      const request = adminProductApi.get('admin', 'ssd')
      assert.equal(calls.length, 1)
      calls[0].resolve(Response.json(product('ssd', [quantity, 2, 0, 8])))
      const updated = freeze(await request)
      p.setProduct(updated)
      const stockRow = () => {
        const table = deep(Table({ branches: updated.inventory.branches, caption: 'Existencias consultadas',
          simulated: h.sim.simulationsFor(p.state, 'admin', 'ssd') }))
        return textOf(nodes(table).find(node => node.type === 'tr' && /San José/.test(textOf(node))))
      }
      assert.match(stockRow(), new RegExp(`San José\\s+${quantity} unidades\\s+Disponible\\s+25 unidades · simulado`))
      const reset = nodes(p.render()).find(node => node.type === 'button'
        && node.props['aria-label'] === 'Restablecer San José al inventario original').props.onClick
      reset()
      assert.equal(p.state.entries[key], undefined)
      assert.equal(Object.keys(p.state.entries).length, 0)
      assert.equal(stockRow(), `San José ${quantity} unidades Disponible`)
      const feedback = textOf(nodes(p.render()).find(node => node.props?.role === 'status'))
      assert.match(feedback, /Simulación descartada en San José/)
      assert.match(feedback, /Se muestra nuevamente el inventario consultado/)
      assert.doesNotMatch(feedback, /18|25|restaur|restablec|actualiz/i)
      reset()
      assert.equal(Object.keys(p.state.entries).length, 0, 'Reset repetido conserva el estado vacío')
      assert.equal(stockRow(), `San José ${quantity} unidades Disponible`)
      assert.equal(calls.length, 1, 'Reset no realiza nuevas consultas ni escrituras')
      assert.equal(calls[0].options.method, 'GET')
      assert.equal(calls[0].options.headers['X-CiberNova-User-Id'], 'admin')
      assert.equal(original.inventory.branches[0].quantity, 18)
      assert.equal(updated.inventory.branches[0].quantity, quantity)
    })
  }
})

test('Reset: aísla producto y sucursal, descarta propuestas pendientes y funciona después del cambio de Session', async t => {
  const h = await load(t)
  const calls = deferredFetch(t)
  const p = panelHarness(h)
  const apply = (branch, value) => { p.selectBranch(branch); p.type(value); p.review(); p.click('Confirmar simulación') }
  const resetBranch = name => nodes(p.render()).find(node => node.type === 'button'
    && node.props['aria-label'] === `Restablecer ${name} al inventario original`).props.onClick()
  apply('san_jose', '25')
  apply('heredia', '4')
  const otherBranch = p.state.entries[h.sim.simulationKey('ssd', 'heredia')]
  p.setProduct(product('other'))
  apply('alajuela', '6')
  const otherProduct = p.state.entries[h.sim.simulationKey('other', 'alajuela')]

  p.setProduct(product('ssd', [7, 2, 0, 8]))
  p.selectBranch('heredia')
  resetBranch('San José')
  assert.equal(p.state.entries[h.sim.simulationKey('ssd', 'san_jose')], undefined)
  assert.equal(p.state.entries[h.sim.simulationKey('ssd', 'heredia')], otherBranch)
  assert.equal(p.state.entries[h.sim.simulationKey('other', 'alajuela')], otherProduct)
  assert.match(textOf(nodes(p.render()).find(node => node.props?.role === 'status')), /Simulación descartada en San José/)

  p.type('5'); p.review()
  const staleConfirm = p.button(p.render(), 'Confirmar simulación').props.onClick
  p.click('Restablecer simulación del producto')
  staleConfirm()
  assert.deepEqual(h.sim.simulationsFor(p.state, 'admin', 'ssd'), [])
  assert.equal(p.state.entries[h.sim.simulationKey('other', 'alajuela')], otherProduct)
  assert.equal(nodes(p.render()).some(node => node.props?.role === 'alertdialog'), false)
  assert.match(textOf(nodes(p.render()).find(node => node.props?.role === 'status')), /Se descartaron las simulaciones de este producto/)
  assert.doesNotMatch(textOf(nodes(p.render()).find(node => node.props?.role === 'status')), /restaur|restablec|actualiz|unidades/i)

  p.setProduct(product('other'))
  resetBranch('Alajuela')
  assert.equal(Object.keys(p.state.entries).length, 0)
  apply('san_jose', '10')
  p.setSession({ ...admin, id: 'admin-2' })
  assert.equal(Object.keys(p.state.entries).length, 0)
  assert.equal(nodes(p.render()).some(node => node.type === 'button' && textOf(node) === 'Restablecer'), false)
  apply('san_jose', '12')
  resetBranch('San José')
  assert.equal(Object.keys(p.state.entries).length, 0)
  assert.equal(p.state.ownerId, 'admin-2')
  assert.match(textOf(nodes(p.render()).find(node => node.props?.role === 'status')), /Simulación descartada en San José/)
  assert.equal(calls.length, 0, 'Todas las operaciones son locales')
})

test('panel: errores de validación e inventario original no disponible impiden aplicar', async t => {
  const h = await load(t)
  const p = panelHarness(h, product('broken', [18, null, 0, 8]))
  p.selectBranch('san_jose')
  for (const [value, message] of [['', /Ingresa una cantidad/], ['-1', /negativa/], ['3.5', /entero/], ['diez', /solo dígitos/]]) {
    p.type(value); p.review()
    const tree = p.render()
    assert.match(textOf(nodes(tree).find(node => node.props?.id === 'simulation-error')), message)
    assert.equal(nodes(tree).find(node => node.type === 'input').props['aria-invalid'], true)
  }
  p.selectBranch('alajuela')
  const tree = p.render()
  assert.equal(p.button(tree, 'Revisar simulación').props.disabled, true)
  assert.match(textOf(tree), /inventario original de Alajuela no está disponible/)
  p.type('5'); p.review()
  assert.deepEqual(p.actions, [])
  assert.equal(nodes(p.render()).some(node => node.props?.role === 'alertdialog'), false)
})

/** fetch diferido que registra cada request de la página de detalle. */
function deferredFetch(t) {
  const calls = []
  t.mock.method(globalThis, 'fetch', (url, options) => new Promise((resolve, reject) => { calls.push({ url: String(url), options, resolve, reject }) }))
  return calls
}

test('detalle ADMIN: Loading, panel con la cantidad del Server y ninguna request adicional al simular', async t => {
  const h = await load(t)
  const calls = deferredFetch(t)
  let state = h.sim.EMPTY_SIMULATION
  const props = () => ({ onCatalogClick() {}, onPolicyNavigate() {}, onCartClick() {}, productId: 'ssd', onBack() {}, simulation: state,
    onSimulationChange: action => { state = h.sim.inventorySimulationReducer(state, action) } })
  const loader = () => {
    const page = h.render('page', h.DetailPage, props())
    const node = nodes(page).find(item => item.type?.name === 'AdminProductLoader')
    return h.render('AdminProductLoader', node.type, node.props)
  }
  assert.match(textOf(loader()), /Cargando producto/)
  calls[0].resolve(Response.json(product()))
  await flush()
  const panel = nodes(deep(loader())).find(node => node.props?.['aria-labelledby'] === 'inventory-simulation-title')
  assert.ok(panel, 'El panel forma parte de Admin Product Detail')
  props().onSimulationChange({ type: 'apply', ownerId: 'admin', productId: 'ssd', branchId: 'cartago', originalQuantity: 0, simulatedQuantity: 12 })
  const text = textOf(deep(loader()))
  assert.match(text, /Cartago\s+0 unidades\s+Agotado\s+12 unidades · simulado/, 'Existencias y Estado conservan el dato del Server')
  assert.equal(calls.length, 1, 'Simular no hace requests')
  assert.equal(calls[0].options.method, 'GET')
})

test('detalle: error de consulta y producto inexistente no muestran el panel; B2C, B2B y sin Session no acceden', async t => {
  const h = await load(t)
  const calls = deferredFetch(t)
  const shell = { onCatalogClick() {}, onPolicyNavigate() {}, onCartClick() {}, onBack() {} }
  for (const [response, message] of [[Response.json({ error: { code: 'CATALOG_UNAVAILABLE' } }, { status: 503 }), /No pudimos consultar el producto/],
    [Response.json({ error: { code: 'PRODUCT_NOT_FOUND' } }, { status: 404 }), /Producto no encontrado/]]) {
    h.runtime.unmount('AdminProductLoader')
    const render = () => {
      const page = h.render('page', h.DetailPage, { ...shell, productId: 'x' })
      const node = nodes(page).find(item => item.type?.name === 'AdminProductLoader')
      return deep(h.render('AdminProductLoader', node.type, node.props))
    }
    render()
    calls.at(-1).resolve(response)
    await flush()
    const tree = render()
    assert.match(textOf(tree), message)
    assert.equal(nodes(tree).some(node => node.props?.['aria-labelledby'] === 'inventory-simulation-title'), false)
  }
  for (const user of [buyer, business, null]) {
    h.runtime.setUser(user)
    const page = deep(h.render('page-' + (user?.id ?? 'none'), h.DetailPage, { ...shell, productId: 'x' }))
    assert.equal(nodes(page).some(node => node.props?.['aria-labelledby'] === 'inventory-simulation-title'), false)
    assert.match(textOf(page), user ? /Acceso no autorizado/ : /Selecciona una identidad/)
  }
})

/** App real con páginas sustituidas: inspecciona qué recibe cada vista. */
async function setupApp(t, user, hash) {
  const h = await reactHarness()
  t.after(() => { if (globalThis.window) h.runtime.dispose() })
  h.runtime.setUser(user)
  h.runtime.setCart({ items: [], totalUnits: 0, hasExternalConflict: false })
  for (const name of ['ProductListingPage', 'CartPage', 'CheckoutPage', 'PolicyPlaceholderPage', 'TermsPage', 'ReturnsPolicyPage', 'FaqPage',
    'AnalyticsDashboardPage', 'MyOrdersPage', 'OrderDetailPage', 'AdminProductsPage', 'AdminProductDetailPage']) h.overrides.set('pages/' + name, dataUrl(`export default '${name}'`))
  for (const name of ['ShippingPolicyPage', 'PrivacyPolicyPage']) h.overrides.set('pages/' + name, dataUrl(`export const ${name} = '${name}'`))
  h.overrides.set('services/analytics', dataUrl('export function trackEvent() {}'))
  h.overrides.set('components/cart/CartPreviewDrawer', dataUrl('export default "CartPreviewDrawer"'))
  h.overrides.set('components/session/LoginDialog', dataUrl('export default "LoginDialog"'))
  const previous = { window: globalThis.window, raf: globalThis.requestAnimationFrame, cancel: globalThis.cancelAnimationFrame }
  globalThis.window = {
    addEventListener() {}, removeEventListener() {}, location: new URL('https://local.test/' + hash), scrollTo() {},
    history: Object.fromEntries(['pushState', 'replaceState'].map(method => [method, (_state, _title, next) => { globalThis.window.location = new URL(next, globalThis.window.location) }])),
  }
  globalThis.requestAnimationFrame = () => 1; globalThis.cancelAnimationFrame = () => {}
  t.after(() => { globalThis.window = previous.window; globalThis.requestAnimationFrame = previous.raf; globalThis.cancelAnimationFrame = previous.cancel })
  const { default: App } = await h.load('App')
  const app = () => h.render('app', App)
  const find = (tree, type) => nodes(tree).find(node => node.type === type)
  return { ...h, app, find }
}

test('App: simulación compartida entre listado y detalle, descartada al cambiar de Session o recargar', async t => {
  const h = await setupApp(t, admin, '#admin/products/ssd')
  let detail = h.find(h.app(), 'AdminProductDetailPage')
  assert.deepEqual(detail.props.simulation, { ownerId: null, entries: {} })
  detail.props.onSimulationChange({ type: 'apply', ownerId: 'admin', productId: 'ssd', branchId: 'heredia', originalQuantity: 8, simulatedQuantity: 25 })
  detail = h.find(h.app(), 'AdminProductDetailPage')
  assert.equal(Object.keys(detail.props.simulation.entries).length, 1)
  detail.props.onBack()
  const list = h.find(h.app(), 'AdminProductsPage')
  assert.equal(Object.keys(list.props.simulation.entries).length, 1, 'El listado ve la misma simulación')
  h.runtime.setUser({ ...admin, id: 'admin-2' })
  assert.deepEqual(h.find(h.app(), 'AdminProductsPage').props.simulation, { ownerId: null, entries: {} }, 'Otra identidad no hereda simulaciones')
  // Recarga: una instancia nueva de App arranca sin simulaciones.
  const reloaded = await setupApp(t, admin, '#admin/products/ssd')
  assert.deepEqual(reloaded.find(reloaded.app(), 'AdminProductDetailPage').props.simulation, { ownerId: null, entries: {} })
})

test('App: B2C, B2B y sin Session no montan la simulación; las vistas comerciales nunca la reciben', async t => {
  for (const user of [buyer, business, null]) {
    const h = await setupApp(t, user, '#admin/products/ssd')
    const tree = h.app()
    assert.equal(h.find(tree, 'AdminProductDetailPage'), undefined)
    assert.equal(window.location.hash, '#catalog')
  }
  const h = await setupApp(t, admin, '#catalog')
  const catalog = h.find(h.app(), 'ProductListingPage')
  assert.ok(catalog)
  for (const name of Object.keys(catalog.props)) assert.doesNotMatch(name, /simulat/i)
})

test('aislamiento: sin persistencia, sin escrituras y sin dependencias desde operaciones comerciales', () => {
  const read = file => readFileSync(new URL('../src/' + file, import.meta.url), 'utf8')
  for (const file of ['utils/inventorySimulation.ts', 'components/admin/InventorySimulationPanel.tsx', 'pages/AdminProductDetailPage.tsx', 'pages/AdminProductsPage.tsx']) {
    const source = read(file)
    assert.doesNotMatch(source, /localStorage|sessionStorage|indexedDB|document\.cookie/, file)
    assert.doesNotMatch(source, /fetch\(|method: '(POST|PUT|PATCH|DELETE)'|saveObject|partialUpdateObject|deleteObject/, file)
  }
  for (const file of ['pages/ProductListingPage.tsx', 'components/catalog/ProductQuickView.tsx', 'components/catalog/BranchSelector.tsx', 'pages/CartPage.tsx',
    'pages/CheckoutPage.tsx', 'services/productApi.ts', 'services/orderApi.ts', 'services/paymentApi.ts', 'services/orderHistoryApi.ts',
    'context/CartProvider.tsx', 'context/cartReducer.ts', 'pages/MyOrdersPage.tsx', 'pages/OrderDetailPage.tsx']) {
    assert.doesNotMatch(read(file), /inventorySimulation|InventorySimulation/, file)
  }
  const css = read('styles/admin/AdminProducts.module.css')
  assert.match(css, /\.simulation \{[^}]*dashed/)
  assert.match(css, /@media \(max-width: 600px\) \{\s*\.simulationForm button/)
})
