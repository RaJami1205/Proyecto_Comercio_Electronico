/** Verifica Confirmation y las guardas de App mediante hooks simulados; no sustituye pruebas de foco en navegador. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

/** Codifica el código recibido como módulo importable en memoria. */
const dataUrl = source => 'data:text/javascript;base64,' + Buffer.from(source).toString('base64')
// Simula hooks y commit; no es un DOM ni una implementación completa de React.
const runtimeUrl = dataUrl(`
  let slots=[], cursor=0, effects=[];
  export let cart=[];
  export function reset(items=[]) { slots=[]; cursor=0; effects=[]; cart=items; }
  export function setCart(items) { cart=items; }
  export function renderStart() { cursor=0; }
  export function useState(initial) {
    const index=cursor++;
    if (!(index in slots)) slots[index]=typeof initial==='function'?initial():initial;
    return [slots[index], value => { slots[index]=typeof value==='function'?value(slots[index]):value; }];
  }
  export function useRef(initial) { const [ref]=useState(()=>({current:initial})); return ref; }
  export function useCallback(callback) { return callback; }
  export function useEffect(effect, deps) {
    const index=cursor++, previous=slots[index];
    if (!previous || deps.some((value,i)=>!Object.is(value,previous[i]))) effects.push(effect);
    slots[index]=deps;
  }
  export function flushEffects() { const pending=effects; effects=[]; pending.forEach(effect=>effect()); return pending; }
  export function useCart() { return {items:cart}; }
  export const Fragment='Fragment';
  export function jsx(type,props) { return {type,props}; }
  export const jsxs=jsx;
`)
const runtime = await import(runtimeUrl)
const modules = new Map([['react',runtimeUrl],['react/jsx-runtime',runtimeUrl],['./hooks/useCart',runtimeUrl]])
for (const name of ['Header','Footer']) modules.set('../components/layout/'+name,dataUrl(`export default '${name}'`))
for (const name of ['ProductListingPage','CartPage','CheckoutPage','PolicyPlaceholderPage','TermsPage','ReturnsPolicyPage','FaqPage']) modules.set('./pages/'+name,dataUrl(`export default '${name}'`))
for (const name of ['ShippingPolicyPage','PrivacyPolicyPage']) modules.set('./pages/'+name,dataUrl(`export const ${name} = '${name}'`))
modules.set('./components/cart/CartPreviewDrawer',dataUrl("export default 'CartPreviewDrawer'"))
/** Transpila el archivo indicado y resuelve únicamente las dependencias aisladas del harness. */
function compile(file) {
  const source=readFileSync(new URL('../src/'+file,import.meta.url),'utf8')
  const js=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2023,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}}).outputText
  return dataUrl(js.replace(/from ['"]([^'"]+)['"]/g,(_,dependency)=>{
    const target=dependency.endsWith('.css')?dataUrl('export default {}'):modules.get(dependency)
    assert.ok(target,'Dependencia sin aislar: '+dependency)
    return 'from '+JSON.stringify(target)
  }))
}
modules.set('./utils/appNavigation', compile('utils/appNavigation.ts'))
const {default:Confirmation}=await import(compile('pages/OrderConfirmationPage.tsx'))
const {default:App}=await import(compile('App.tsx'))
/** Recorre el árbol JSX simulado y devuelve sus nodos para inspeccionar propiedades. */
function nodes(tree) {
  if (Array.isArray(tree)) return tree.flatMap(nodes)
  return tree && typeof tree==='object' ? [tree,...nodes(tree.props?.children)] : []
}
/** Extrae el texto del árbol JSX simulado para comprobar los mensajes presentados. */
function text(tree) {
  if (Array.isArray(tree)) return tree.map(text).join(' ')
  if (tree && typeof tree==='object') return text(tree.props?.children)
  return typeof tree==='string'||typeof tree==='number'?String(tree):''
}
const order={id:'order-1',orderNumber:'CN-authoritative',createdAt:'2026-10-12T12:00:00Z',
  orderStatus:'CONFIRMED',paymentStatus:'APPROVED',currency:'CRC',
  buyer:{fullName:'Comprador',email:'test@example.com',phone:'88888888'},
  delivery:{province:'San José',canton:'Central',address:'Dirección'},
  items:[{productId:'p',name:'Producto comprado',image:'',quantity:2,unitPrice:12000,lineSubtotal:24000}],
  totals:{subtotal:24000,tax:3120,shipping:3500,total:30620}}
const props={order,onCatalogClick:()=>{},onCartClick:()=>{}}
/** Renderiza Confirmation con las propiedades sustituidas e inicia el ciclo de hooks simulado. */
function renderConfirmation(overrides={}) { runtime.renderStart(); return Confirmation({...props,...overrides}) }

for (const orderStatus of ['PENDING','CONFIRMED']) {
  for (const paymentStatus of ['PENDING','DECLINED','ERROR','APPROVED']) {
    test(`Confirmation requiere ambos estados: ${orderStatus}/${paymentStatus}`,()=>{
      runtime.reset()
      const tree=renderConfirmation({order:{...order,orderStatus,paymentStatus}})
      const heading=nodes(tree).find(n=>n.type==='h1')
      const approved=orderStatus==='CONFIRMED'&&paymentStatus==='APPROVED'
      assert.equal(text(heading),approved?'Compra confirmada':'No pudimos mostrar la confirmación')
      assert.equal(nodes(tree).some(n=>n.props.role==='status'),approved)
      if (!approved) assert.equal(heading.props.tabIndex,undefined)
    })
  }
}

test('Confirmation usa snapshot autoritativo con Cart vacío o diferente, sin requests, y permite Catalog',t=>{
  const requests=[]
  t.mock.method(globalThis,'fetch',(...args)=>{requests.push(args); throw new Error('Request inesperado')})
  /** Formatea el importe esperado en CRC para comparar la presentación de la Order. */
  const money=value=>new Intl.NumberFormat('es-CR',{style:'currency',currency:'CRC'}).format(value)
  for (const cart of [[],[{productId:'other',price:1,quantity:99}]]) {
    runtime.reset(cart)
    let exits=0
    const tree=renderConfirmation({onCatalogClick:()=>{exits++}})
    assert.ok(text(tree).includes(order.orderNumber))
    assert.ok(text(tree).includes(order.items[0].name))
    for (const value of [...Object.values(order.totals),12000,24000]) assert.ok(text(tree).includes(money(value)))
    assert.match(text(tree), /2\s+×/)
    const buttons=nodes(tree).filter(n=>n.type==='button')
    assert.equal(buttons.length,1)
    assert.equal(text(buttons[0]),'Volver al catálogo')
    buttons[0].props.onClick()
    assert.equal(exits,1)
    runtime.flushEffects()
    assert.deepEqual(requests,[])
  }
})

test('F3 destino semántico, foco tras commit y sin reenfocar por renders ordinarios',()=>{
  runtime.reset()
  const tree=renderConfirmation()
  const heading=nodes(tree).find(n=>n.type==='h1')
  assert.equal(heading.props.tabIndex,-1)
  assert.ok(heading.props.ref)
  let calls=0
  heading.props.ref.current={focus:()=>{calls++}}
  const effects=runtime.flushEffects()
  assert.equal(calls,1)
  effects.forEach(effect=>effect()) // repetición inicial de efecto como en StrictMode
  assert.equal(calls,2)
  renderConfirmation({order:structuredClone(order)})
  runtime.flushEffects()
  assert.equal(calls,2)
})

/** Prepara Cart e historial simulados para App y registra la restauración del entorno al terminar la prueba. */
function appEnvironment(t,items) {
  const previous=globalThis.window
  globalThis.window={location:{hash:'#checkout',pathname:'/',search:''},history:{
    pushState:(_state,_unused,hash)=>{globalThis.window.location.hash=hash},
    replaceState:(_state,_unused,hash)=>{globalThis.window.location.hash=hash},
  }}
  t.after(()=>{globalThis.window=previous})
  runtime.reset(items)
  return ()=>{runtime.renderStart(); return App()}
}
test('App conserva la guarda de entrada a Checkout con Cart vacío',t=>{
  const render=appEnvironment(t,[])
  render()
  const tree=render()
  assert.equal(nodes(tree).some(n=>n.type==='CheckoutPage'),false)
  assert.ok(nodes(tree).find(n=>n.type==='CartPage').props.navigationNotice)
})
test('App mantiene Checkout con Order y Cart vacío; salida al catálogo desmonta Checkout',t=>{
  const render=appEnvironment(t,[{productId:'p',quantity:1}])
  const checkout=nodes(render()).find(n=>n.type==='CheckoutPage').props
  checkout.onOrderCreated()
  runtime.setCart([])
  const tree=render()
  assert.ok(nodes(tree).find(n=>n.type==='CheckoutPage'))
  nodes(tree).find(n=>n.type==='CheckoutPage').props.onCatalogClick()
  const after=render()
  assert.equal(nodes(after).some(n=>n.type==='CheckoutPage'),false)
  assert.equal(nodes(after).find(n=>n.type==='ProductListingPage').props.active,true)
})
