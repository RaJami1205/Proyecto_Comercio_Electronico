/** F3.1: IDs con React real y handlers/contexto con el harness existente; sin red ni storage. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { createElement, Fragment } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { dataUrl } from './helpers/analyticsHarness.mjs'
import { reactHarness, nodes, label } from './helpers/reactHarness.mjs'

const require = createRequire(import.meta.url)
const branches = [
  { id: 'san_jose', name: 'San José', available: true },
  { id: 'alajuela', name: 'Alajuela', available: true },
  { id: 'cartago', name: 'Cartago', available: true },
  { id: 'heredia', name: 'Heredia', available: false },
]
const tick = () => new Promise(resolve => setImmediate(resolve))
const select = tree => nodes(tree).find(node => node.type === 'select').props
function association(tree) {
  const control = select(tree)
  assert.ok(control.id)
  assert.equal(nodes(tree).find(node => node.type === 'label').props.htmlFor, control.id)
  return control.id
}

for (const count of [1, 2]) {
  test('React genera IDs únicos y labels asociados para ' + count + ' instancia(s)', async () => {
    const h = await reactHarness()
    // Reutiliza el compilador del harness, pero React, useId y useContext son reales en esta prueba.
    for (const module of ['react', 'react/jsx-runtime']) h.overrides.set(module, pathToFileURL(require.resolve(module)).href)
    h.overrides.delete('hooks/useBranch')
    h.overrides.delete('components/catalog/BranchSelector')
    const { BranchContext } = await h.load('context/BranchContext')
    const { default: BranchSelector } = await h.load('components/catalog/BranchSelector')
    const value = { branches, selectedBranchId: 'san_jose', setSelectedBranchId() {}, isLoading: false, error: null }
    const markup = renderToStaticMarkup(createElement(BranchContext.Provider, { value },
      createElement(Fragment, null, ...Array.from({ length: count }, (_, key) => createElement(BranchSelector, { key })))))
    const ids = [...markup.matchAll(/<select\b[^>]*\bid="([^"]+)"/g)].map(match => match[1])
    const targets = [...markup.matchAll(/<label\b[^>]*\bfor="([^"]+)"/g)].map(match => match[1])
    assert.equal(ids.length, count)
    assert.equal(new Set(ids).size, count)
    assert.deepEqual(targets, ids)
    assert.equal([...markup.matchAll(/<option value="san_jose" selected=""/g)].length, count)
  })
}

async function flow(t) {
  const h = await reactHarness()
  t.after(() => h.runtime.dispose())
  const contextUrl = dataUrl(`
    let context;
    export const BranchContext={Provider:'BranchContext.Provider'};
    export function setContext(value){context=value;}
    export function useBranch(){return context;}
  `) + '#' + h.url.split('#').at(-1)
  const apiUrl = dataUrl(`
    export let resolveBranches,rejectBranches;
    const result=new Promise((resolve,reject)=>{resolveBranches=resolve;rejectBranches=reject;});
    export function getBranches(){return result;}
  `) + '#' + h.url.split('#').at(-1)
  h.overrides.set('context/BranchContext', contextUrl)
  h.overrides.set('hooks/useBranch', contextUrl)
  h.overrides.set('services/productApi', apiUrl)
  h.overrides.delete('components/catalog/BranchSelector')
  const context = await import(contextUrl), api = await import(apiUrl)
  const { default: Provider } = await h.load('context/BranchProvider')
  const { default: Selector } = await h.load('components/catalog/BranchSelector')
  let trees, value
  function render() {
    value = h.render('provider', Provider, { children: null }).props.value
    context.setContext(value)
    trees = ['catalog', 'cart'].map(scope => h.render(scope, Selector))
    return trees
  }
  render()
  return { render, get trees() { return trees }, get value() { return value },
    async loaded() { api.resolveBranches(branches); await tick(); return render() },
    async failed() { api.rejectBranches(new Error('Fallo simulado')); await tick(); return render() },
    change(index, branchId) { select(trees[index]).onChange({ target: { value: branchId } }); return render() },
  }
}

test('Catalog y Cart conservan IDs distintos y estables tras re-renders y carga de Branch Context', async t => {
  const h = await flow(t)
  const ids = h.trees.map(association)
  assert.equal(new Set(ids).size, 2)
  assert.deepEqual(h.render().map(association), ids)
  await h.loaded()
  assert.deepEqual(h.trees.map(association), ids)
  h.change(0, 'alajuela')
  assert.deepEqual(h.trees.map(association), ids)
})

test('cambiar sucursal desde cualquiera de las instancias sincroniza el BranchProvider real', async t => {
  const h = await flow(t)
  await h.loaded()
  for (const [index, branchId] of [[0, 'san_jose'], [1, 'cartago'], [0, 'alajuela'], [1, '']]) {
    h.change(index, branchId)
    assert.equal(h.value.selectedBranchId, branchId || null)
    assert.deepEqual(h.trees.map(tree => select(tree).value), [branchId, branchId])
    h.trees.forEach(association)
  }
  // La guarda comercial existente del Provider sigue rechazando sucursales no disponibles o inexistentes.
  h.change(0, 'heredia')
  assert.equal(h.value.selectedBranchId, null)
  h.change(1, 'unknown')
  assert.equal(h.value.selectedBranchId, null)
})

test('Loading conserva asociaciones y deshabilita ambas instancias hasta cargar las sucursales', async t => {
  const h = await flow(t)
  const ids = h.trees.map(association)
  for (const tree of h.trees) {
    assert.equal(select(tree).disabled, true)
    assert.equal(select(tree)['aria-busy'], true)
    assert.match(label(nodes(tree).find(node => node.props?.role === 'status')), /Cargando sucursales/)
  }
  await h.loaded()
  assert.deepEqual(h.trees.map(association), ids)
  for (const tree of h.trees) {
    assert.equal(select(tree).disabled, false)
    assert.equal(select(tree)['aria-busy'], false)
    const options = nodes(tree).filter(node => node.type === 'option')
    assert.equal(options.length, 5)
    assert.equal(options.find(node => node.props.value === 'heredia').props.disabled, true)
    assert.ok(nodes(tree).some(node => node.props?.role === 'note'))
    assert.equal(nodes(tree).some(node => node.props?.role === 'status'), false)
  }
})

test('Error conserva IDs y labels y presenta el error existente en las dos instancias', async t => {
  const h = await flow(t)
  const ids = h.trees.map(association)
  await h.failed()
  assert.deepEqual(h.trees.map(association), ids)
  for (const tree of h.trees) {
    assert.equal(select(tree).disabled, true)
    assert.equal(select(tree)['aria-busy'], false)
    assert.equal(select(tree).value, '')
    assert.equal(label(nodes(tree).find(node => node.props?.role === 'alert')), h.value.error)
    assert.equal(nodes(tree).some(node => node.props?.role === 'status' || node.props?.role === 'note'), false)
  }
})
