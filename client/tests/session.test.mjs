/** Ejercita el Provider real con hooks/Cart simulados; no sustituye las verificaciones de navegador. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

const dataUrl = source => 'data:text/javascript;base64,' + Buffer.from(source).toString('base64')
const runtimeUrl = dataUrl(`
  let slots=[], cursor=0, effects=[];
  export let cart=[], revision=0, conflict=false, clears=0;
  export function dispose() { slots.forEach(slot=>slot?.cleanup?.()); }
  export function reset(items=[]) { dispose(); slots=[];cursor=0;effects=[];cart=items;revision=0;conflict=false;clears=0; }
  export function begin() { cursor=0; }
  export function useState(initial) { const index=cursor++; if(!(index in slots))slots[index]=typeof initial==='function'?initial():initial; return [slots[index],value=>{slots[index]=typeof value==='function'?value(slots[index]):value}]; }
  export function useRef(initial) { const [ref]=useState(()=>({current:initial})); return ref; }
  export function useCallback(callback,deps) { const index=cursor++, previous=slots[index]; if(!previous||deps.some((dep,i)=>!Object.is(dep,previous.deps[i])))slots[index]={callback,deps}; return slots[index].callback; }
  export function useEffect(effect,deps) { const index=cursor++,previous=slots[index]; if(!previous||deps.some((dep,i)=>!Object.is(dep,previous.deps[i]))) { slots[index]={deps,cleanup:previous?.cleanup}; effects.push(()=>{slots[index].cleanup?.();slots[index].cleanup=effect()}); } }
  export function flush() { const pending=effects;effects=[];pending.forEach(effect=>effect()); }
  export function changeCart(items) { cart=items;revision++; }
  export function externalChange() { conflict=true;revision++; }
  const getSnapshot=()=>({items:cart,revision,hasExternalConflict:conflict});
  const clearCart=()=>{cart=[];revision++;conflict=false;clears++;};
  export function useCart() { return {getSnapshot,clearCart,items:cart,hasExternalConflict:conflict}; }
  export function jsx(type,props) {return {type,props};} export const jsxs=jsx;
`)
const runtime = await import(runtimeUrl)
function compile(file, modules) {
  const source = readFileSync(new URL('../src/' + file, import.meta.url), 'utf8').replace('import.meta.env.VITE_API_BASE_URL', 'undefined')
  const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX } }).outputText
  return dataUrl(js.replace(/from ['"]([^'"]+)['"]/g, (_match, dependency) => {
    assert.ok(modules.has(dependency), 'Dependencia inesperada: ' + dependency)
    return 'from ' + JSON.stringify(modules.get(dependency))
  }))
}
const apiUrl = compile('services/sessionApi.ts', new Map())
const modules = new Map([['react', runtimeUrl], ['react/jsx-runtime', runtimeUrl], ['../hooks/useCart', runtimeUrl],
  ['./SessionContext', dataUrl("export const SessionContext={Provider:'SessionProvider'}")], ['../services/sessionApi', apiUrl]])
const { default: SessionProvider } = await import(compile('context/SessionProvider.tsx', modules))
const profiles = [
  { id: 'c', displayName: 'Cliente', role: 'B2C' },
  { id: 'b', displayName: 'Empresa', role: 'B2B', company: { id: 'co', name: 'Empresa Demo' } },
  { id: 'a', displayName: 'Administrador', role: 'ADMIN' },
]
const item = { productId: 'p', name: 'Producto', image: '', price: 10000, quantity: 1 }
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done }); return { promise, resolve } }
function flow(t, items = []) {
  runtime.reset(items)
  t.after(() => runtime.dispose())
  const calls = []
  let responder = id => Response.json({ user: profiles.find(user => user.id === id) })
  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    const id = JSON.parse(options.body).userId
    calls.push(id)
    return responder(id)
  })
  const render = () => { runtime.begin(); const value = SessionProvider({ children: null }).props.value; runtime.flush(); return value }
  return { render, calls, respond: handler => { responder = handler } }
}

test('inicia null, sin restauración ni escrituras de Session', t => {
  const previous = globalThis.window
  globalThis.window = { get localStorage() { throw new Error('Session no puede leer storage') }, get sessionStorage() { throw new Error('Session no puede leer storage') } }
  t.after(() => { globalThis.window = previous })
  const session = flow(t, [item])
  assert.equal(session.render().user, null)
  assert.match(session.render().purchaseBlockReason, /Inicia/)
  assert.deepEqual(session.calls, [])
})

for (const profile of profiles) test('Login validado ' + profile.role + ' y restricción de compra correspondiente', async t => {
  const session = flow(t)
  session.render().openLogin()
  await session.render().resolveUser(profile.id)
  const state = session.render()
  assert.deepEqual(state.user, profile)
  assert.equal(state.epoch, 1)
  assert.equal(state.dialog, null)
  assert.equal(state.purchaseBlockReason === null, profile.role === 'B2C')
  assert.equal(runtime.clears, 0)
  state.openLogin()
  await session.render().resolveUser(profile.id)
  assert.equal(session.render().epoch, 1, 'Seleccionar la misma identidad no inicia otra sesión')
})

test('Cart restaurado requiere consentimiento y cancelar no lo modifica', async t => {
  const session = flow(t, [item])
  session.render().openLogin()
  await session.render().resolveUser('c')
  let state = session.render()
  assert.equal(state.user, null)
  assert.ok(state.pending)
  assert.equal(runtime.clears, 0)
  state.cancelTransition()
  assert.deepEqual(runtime.cart, [item])
  assert.equal(session.render().user, null)
  session.render().openLogin()
  await session.render().resolveUser('c')
  state = session.render()
  const consent = state.pending.cartRevision
  state.confirmTransition(consent)
  state.confirmTransition(consent)
  assert.equal(runtime.clears, 1)
  assert.equal(session.render().user.id, 'c')
})

test('Logout y cambio preservan identidad/Cart ante cancelación o error', async t => {
  const session = flow(t)
  session.render().openLogin()
  await session.render().resolveUser('c')
  runtime.changeCart([item])
  session.render().requestLogout()
  assert.equal(session.render().user.id, 'c')
  session.render().cancelTransition()
  session.respond(() => Response.json({ error: { code: 'USER_DISABLED' } }, { status: 403 }))
  session.render().openLogin()
  await session.render().resolveUser('disabled')
  assert.match(session.render().error, /deshabilitada/)
  assert.equal(session.render().user.id, 'c')
  assert.deepEqual(runtime.cart, [item])
  session.render().cancelTransition()
  session.respond(id => Response.json({ user: profiles.find(user => user.id === id) }))
  session.render().openLogin()
  await session.render().resolveUser('b')
  const pending = session.render()
  pending.confirmTransition(pending.pending.cartRevision)
  assert.equal(session.render().user.id, 'b')
  assert.equal(runtime.clears, 1)
  session.render().requestLogout()
  assert.equal(session.render().user, null)
  assert.equal(session.render().epoch, 3)
})

test('doble submit y respuestas obsoletas tras cancelar no cambian Session', async t => {
  const session = flow(t)
  const response = deferred()
  session.respond(() => response.promise)
  session.render().openLogin()
  const state = session.render()
  const pending = state.resolveUser('c')
  await state.resolveUser('c')
  assert.deepEqual(session.calls, ['c'])
  session.render().cancelTransition()
  session.respond(() => Response.json({ user: profiles[2] }))
  session.render().openLogin()
  await session.render().resolveUser('a')
  response.resolve(Response.json({ user: profiles[0] }))
  await pending
  assert.equal(session.render().user.id, 'a')
  assert.equal(session.render().epoch, 1)
})

test('revalida Cart después de resolver y exige consentimiento nuevo si vuelve a cambiar', async t => {
  const session = flow(t)
  const response = deferred()
  session.respond(() => response.promise)
  session.render().openLogin()
  const pending = session.render().resolveUser('c')
  runtime.changeCart([item])
  response.resolve(Response.json({ user: profiles[0] }))
  await pending
  const previousConsent = session.render()
  const revision = previousConsent.pending.cartRevision
  runtime.changeCart([{ ...item, quantity: 2 }])
  previousConsent.confirmTransition(revision)
  previousConsent.confirmTransition(revision)
  assert.equal(runtime.clears, 0)
  assert.equal(session.render().user, null)
  assert.match(session.render().error, /carrito cambió/)
  const latest = session.render()
  latest.confirmTransition(latest.pending.cartRevision)
  assert.equal(runtime.clears, 1)
  assert.equal(session.render().user.id, 'c')
})

test('operaciones activas/inciertas y Checkout montado bloquean cambios, incluso tras await', async t => {
  const session = flow(t)
  for (const transaction of ['active', 'uncertain']) {
    session.render().setTransactionState(transaction)
    session.render().openLogin()
    assert.equal(session.render().dialog, null)
    assert.equal(session.render().isTransactionBlocked(), true)
  }
  session.render().setTransactionState('idle')
  session.render().setCheckoutMounted(true)
  session.render().openLogin()
  assert.equal(session.render().dialog, null)
  session.render().setCheckoutMounted(false)
  const response = deferred()
  session.respond(() => response.promise)
  session.render().openLogin()
  const pending = session.render().resolveUser('c')
  session.render().setTransactionState('active')
  response.resolve(Response.json({ user: profiles[0] }))
  await pending
  assert.equal(session.render().user, null)
  assert.match(session.render().error, /pendiente/)
})

test('un conflicto externo bloquea compra inmediatamente y solo se descarta con confirmación', async t => {
  const session = flow(t)
  session.render().openLogin()
  await session.render().resolveUser('c')
  const state = session.render()
  runtime.externalChange()
  assert.match(state.getPurchaseBlockReason(), /otra pestaña/)
  state.resolveCartConflict()
  assert.equal(runtime.clears, 0)
  session.render().cancelTransition()
  assert.equal(runtime.conflict, true)
  session.render().resolveCartConflict()
  const latest = session.render()
  latest.confirmTransition(latest.pending.cartRevision)
  assert.equal(runtime.conflict, false)
  assert.equal(session.render().user.id, 'c')
  assert.equal(session.render().epoch, 1, 'Resolver Cart no inicia otra sesión')
})

test('un desmontaje invalida la petición y un nuevo Provider comienza sin identidad', async t => {
  const session = flow(t)
  const response = deferred()
  session.respond(() => response.promise)
  session.render().openLogin()
  const pending = session.render().resolveUser('c')
  runtime.dispose()
  response.resolve(Response.json({ user: profiles[0] }))
  await pending
  assert.equal(session.render().user, null)
  runtime.reset([item])
  assert.equal(session.render().user, null)
  assert.deepEqual(runtime.cart, [item])
})
