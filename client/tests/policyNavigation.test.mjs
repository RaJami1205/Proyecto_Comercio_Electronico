/** Verifica rutas y componentes informativos reales con historial y hooks simulados; no sustituye pruebas de navegador. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

/** Construye un módulo aislado en memoria sin generar archivos. */
const dataUrl = source => 'data:text/javascript;base64,' + Buffer.from(source).toString('base64')
const runtimeUrl = dataUrl(`
  let slots=[], cursor=0, effects=[], ids=0;
  export let cart=[];
  export function dispose() { slots.forEach(slot=>slot?.cleanup?.()); }
  export function reset(items=[]) { slots=[]; cursor=0; effects=[]; ids=0; cart=items; }
  export function begin() { cursor=0; }
  export function useState(initial) {
    const index=cursor++;
    if (!(index in slots)) slots[index]=typeof initial==='function'?initial():initial;
    return [slots[index], value=>{slots[index]=typeof value==='function'?value(slots[index]):value}];
  }
  export function useRef(initial) { const [ref]=useState(()=>({current:initial})); return ref; }
  export function useCallback(callback) { return callback; }
  export function useId() { return 'test-id-'+ids++; }
  export function useEffect(effect,deps) {
    const index=cursor++, previous=slots[index];
    if (!previous || deps.some((value,i)=>!Object.is(value,previous.deps[i]))) {
      slots[index]={deps,cleanup:previous?.cleanup};
      effects.push(()=>{slots[index].cleanup?.(); slots[index].cleanup=effect();});
    }
  }
  export function flush() { const pending=effects; effects=[]; pending.forEach(effect=>effect()); }
  export function useCart() { return {items:cart,totalUnits:cart.length}; }
  export const Fragment='Fragment';
  export function jsx(type,props) { return {type,props}; }
  export const jsxs=jsx;
`)
const runtime = await import(runtimeUrl)
const modules = new Map()
// Solo se sustituyen las vistas ajenas al alcance. Las rutas, Footer, Header y políticas son código real.
for (const name of ['ProductListingPage', 'CartPage', 'CheckoutPage']) {
  modules.set(`pages/${name}`, dataUrl(`export default '${name}'`))
}
modules.set('components/cart/CartPreviewDrawer', dataUrl("export default 'CartPreviewDrawer'"))
modules.set('hooks/useCart', runtimeUrl)

/** Transpila módulos locales y aísla estilos/React; falla ante una dependencia externa inesperada. */
function compile(file) {
  const key = file.replace(/\.(tsx?|mjs)$/, '')
  if (modules.has(key)) return modules.get(key)
  const source = readFileSync(new URL('../src/' + file, import.meta.url), 'utf8')
  const js = ts.transpileModule(source, {compilerOptions:{target:ts.ScriptTarget.ES2023,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}}).outputText
  const compiled = dataUrl(js.replace(/from ['"]([^'"]+)['"]/g, (_, dependency) => {
    if (dependency === 'react' || dependency === 'react/jsx-runtime') return 'from ' + JSON.stringify(runtimeUrl)
    if (dependency.endsWith('.css')) return 'from ' + JSON.stringify(dataUrl('export default {}'))
    assert.ok(dependency.startsWith('.'), 'Dependencia no autorizada: ' + dependency)
    const path = new URL(dependency, 'https://source/' + file).pathname.slice(1)
    const existing = modules.get(path)
    const resolved = existing ?? compile(path + (path.includes('components/') || path.includes('pages/') ? '.tsx' : '.ts'))
    return 'from ' + JSON.stringify(resolved)
  }))
  modules.set(key, compiled)
  return compiled
}

const { policyDestinations, viewFromHash } = await import(compile('utils/appNavigation.ts'))
const { default: ReturnsPolicyPage } = await import(compile('pages/ReturnsPolicyPage.tsx'))
const { returnsPolicy } = await import(compile('content/returnsPolicy.ts'))
const { default: TermsPage } = await import(compile('pages/TermsPage.tsx'))
const { default: TermsContent } = await import(compile('components/policies/TermsContent.tsx'))
const { termsPolicy } = await import(compile('content/terms.ts'))
const { default: App } = await import(compile('App.tsx'))
const { default: Footer } = await import(compile('components/layout/Footer.tsx'))
const { default: Header } = await import(compile('components/layout/Header.tsx'))
const { default: PolicyPage } = await import(compile('pages/PolicyPlaceholderPage.tsx'))
const { default: PolicyLayout } = await import(compile('components/policies/PolicyLayout.tsx'))
const { default: PolicySection } = await import(compile('components/policies/PolicySection.tsx'))

/** Recorre el árbol simulado sin ejecutar componentes hijos. */
function nodes(tree) {
  if (Array.isArray(tree)) return tree.flatMap(nodes)
  return tree && typeof tree === 'object' ? [tree, ...nodes(tree.props?.children)] : []
}

/** Ejecuta los componentes de presentación reales para inspeccionar sus landmarks y contenido. */
function expand(tree) {
  if (Array.isArray(tree)) return tree.map(expand)
  if (!tree || typeof tree !== 'object') return tree
  if (typeof tree.type === 'function') return expand(tree.type(tree.props))
  return {...tree, props:{...tree.props, children:expand(tree.props?.children)}}
}

/** Obtiene el texto presentado por el árbol de prueba. */
function text(tree) {
  if (Array.isArray(tree)) return tree.map(text).join(' ')
  if (tree && typeof tree === 'object') return text(tree.props?.children)
  return typeof tree === 'string' ? tree : ''
}

/** Simula un click con propiedades de enlace y registra si se intercepta su comportamiento nativo. */
function click(props, overrides = {}) {
  const event = {button:0, defaultPrevented:false, currentTarget:{target:props.target ?? ''},
    preventDefault() { this.defaultPrevented = true }, ...overrides}
  props.onClick(event)
  return event
}

/** Instala un historial con URL base, eventos y frames controlados para ejecutar los efectos reales de App. */
function environment(t, hash = '#catalog', items = [{productId:'p', quantity:1}]) {
  runtime.reset(items)
  const originals = new Map()
  /** Instala APIs ausentes en Node y conserva sus descriptores para restaurarlas al terminar. */
  function install(name, value) {
    originals.set(name, Object.getOwnPropertyDescriptor(globalThis, name))
    Object.defineProperty(globalThis, name, {value, writable:true, configurable:true})
  }
  const listeners = new Map(), frames = new Map(), focused = [], visited = []
  let frameId = 0, index = 0
  const history = [new URL('https://example.test/Proyecto_Comercio_Electronico/?source=test' + hash)]
  const windowMock = {
    location:history[0], scrollTo() {}, clearTimeout() {},
    addEventListener(name, listener) { listeners.set(name, listener) },
    removeEventListener(name, listener) { if (listeners.get(name) === listener) listeners.delete(name) },
    history:{
      pushState(_state, _unused, url) {
        history.splice(index + 1); history.push(new URL(url, windowMock.location)); index++
        windowMock.location = history[index]; visited.push('push')
      },
      replaceState(_state, _unused, url) {
        history[index] = new URL(url, windowMock.location); windowMock.location = history[index]; visited.push('replace')
      },
    },
  }
  install('window', windowMock)
  install('document', {
    getElementById:()=>null,
    querySelectorAll:()=>[
      {closest:()=>({hidden:true}),getClientRects:()=>[1],focus:()=>focused.push('hidden')},
      {closest:()=>null,getClientRects:()=>[],focus:()=>focused.push('invisible')},
      {closest:()=>null,getClientRects:()=>[1],focus:()=>focused.push('visible')},
    ],
  })
  install('requestAnimationFrame', callback => {frames.set(++frameId, callback); return frameId})
  install('cancelAnimationFrame', id => frames.delete(id))
  t.mock.method(globalThis, 'fetch', () => { throw new Error('No se permite red en estas pruebas') })
  t.after(() => {
    runtime.dispose()
    for (const [name, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor)
      else delete globalThis[name]
    }
  })
  return {
    focused, visited, window:windowMock,
    render() { runtime.begin(); const tree = App(); runtime.flush(); const pending=[...frames.values()]; frames.clear(); pending.forEach(callback=>callback()); return tree },
    travel(delta) { index += delta; windowMock.location=history[index]; listeners.get('popstate')(); listeners.get('hashchange')() },
    hashchange(hash) { windowMock.location = new URL(hash, windowMock.location); listeners.get('hashchange')() },
  }
}

test('conserva rutas previas y fallback; resuelve los cinco destinos informativos', () => {
  for (const hash of ['', '#top', '#catalog', '#about', '#unknown']) assert.equal(viewFromHash(hash), 'catalog')
  assert.equal(viewFromHash('#cart-page'), 'cart')
  assert.equal(viewFromHash('#checkout'), 'checkout')
  for (const destination of policyDestinations) assert.equal(viewFromHash(destination.hash), destination.view)
})

for (const destination of policyDestinations) {
  test(`entrada directa y nuevo montaje en ${destination.hash}, incluso con Cart vacío`, t => {
    const app = environment(t, destination.hash, [])
    for (let reload = 0; reload < 2; reload++) {
      if (reload) { runtime.dispose(); runtime.reset([]) }
      const tree = app.render()
      const page = nodes(tree).find(n => n.type === (destination.view === 'terms' ? TermsPage : destination.view === 'returns-policy' ? ReturnsPolicyPage : PolicyPage))
      assert.ok(page)
      assert.equal(destination.view === 'terms' ? termsPolicy.title : destination.view === 'returns-policy' ? 'Política de devoluciones' : page.props.destination.title, destination.title)
      assert.equal(nodes(tree).find(n => n.type === 'ProductListingPage').props.active, false)
      assert.equal(nodes(tree).some(n => n.type === 'CheckoutPage' || n.type === 'CartPage'), false)
      assert.equal(app.window.location.pathname, '/Proyecto_Comercio_Electronico/')
    }
    assert.deepEqual(app.visited, [])
    assert.deepEqual(app.focused, ['visible', 'visible'])
  })
}

test('navegación desde Catalog y Cart preserva base, query y Back/Forward entre políticas', t => {
  const app = environment(t)
  let tree = app.render()
  nodes(tree).find(n => n.type === 'ProductListingPage').props.onPolicyNavigate('terms')
  tree = app.render()
  nodes(tree).find(n => n.type === TermsPage).props.onPolicyNavigate('faq')
  tree = app.render()
  assert.equal(app.window.location.hash, '#faq')
  app.travel(-1); tree = app.render()
  assert.ok(nodes(tree).find(n => n.type === TermsPage))
  app.travel(-1); tree = app.render()
  assert.equal(nodes(tree).find(n => n.type === 'ProductListingPage').props.active, true)
  app.travel(1); tree = app.render()
  nodes(tree).find(n => n.type === TermsPage).props.onCatalogClick('#about')
  tree = app.render()
  assert.equal(app.window.location.hash, '#about')
  assert.equal(app.window.location.search, '?source=test')
  assert.equal(app.window.location.pathname, '/Proyecto_Comercio_Electronico/')
  app.hashchange('#cart-page'); tree = app.render()
  nodes(tree).find(n => n.type === 'CartPage').props.onPolicyNavigate('shipping-policy')
  tree = app.render()
  assert.equal(nodes(tree).find(n => n.type === PolicyPage).props.destination.view, 'shipping-policy')
  assert.ok(!app.focused.includes('hidden'))
})

test('Checkout bloqueado conserva guardas de callbacks e historial', t => {
  const app = environment(t, '#checkout')
  let tree = app.render()
  const checkout = nodes(tree).find(n => n.type === 'CheckoutPage').props
  checkout.onNavigationLockChange(true)
  nodes(tree).find(n => n.type === 'ProductListingPage').props.onPolicyNavigate('terms')
  assert.equal(app.window.location.hash, '#checkout')
  app.hashchange('#faq'); tree = app.render()
  assert.equal(app.window.location.hash, '#checkout')
  assert.ok(app.visited.includes('replace'))
  assert.ok(nodes(tree).find(n => n.type === 'CheckoutPage'))
  assert.equal(nodes(tree).some(n => n.type === PolicyPage || n.type === TermsPage || n.type === ReturnsPolicyPage), false)
  checkout.onNavigationLockChange(false)
  checkout.onBackToCart(); tree = app.render()
  assert.ok(nodes(tree).find(n => n.type === 'CartPage'))
})

test('entrada a Checkout sin productos mantiene reemplazo por Cart', t => {
  const app = environment(t, '#checkout', [])
  app.render()
  const tree = app.render()
  assert.equal(app.window.location.hash, '#cart-page')
  assert.ok(nodes(tree).find(n => n.type === 'CartPage').props.navigationNotice)
  assert.equal(nodes(tree).some(n => n.type === 'CheckoutPage'), false)
})

test('Footer delega enlaces ordinarios y conserva clicks modificados', () => {
  runtime.reset()
  const calls = []
  const tree = Footer({onPolicyNavigate:view=>calls.push(view)})
  for (const destination of policyDestinations) {
    const link = nodes(tree).find(n => n.type === 'a' && n.props.href === destination.hash)
    assert.ok(link)
    assert.equal(link.props.target, undefined)
    assert.equal(click(link.props).defaultPrevented, true)
    for (const modifier of [{ctrlKey:true}, {metaKey:true}, {shiftKey:true}, {altKey:true}, {button:1}, {defaultPrevented:true}]) {
      const before = calls.length
      click(link.props, modifier)
      assert.equal(calls.length, before)
    }
  }
  assert.deepEqual(calls, policyDestinations.map(destination=>destination.view))
})

test('Footer de Checkout usa otra pestaña y aviso accesible sin invocar navegación', () => {
  runtime.reset()
  const tree = Footer({onCatalogClick:()=>{throw new Error('No debe abandonar Checkout')}})
  for (const destination of policyDestinations) {
    const links = nodes(tree).filter(n=>n.type === 'a' && n.props.href === destination.hash)
    for (const link of links) {
      assert.equal(link.props.target, '_blank')
      assert.equal(link.props.rel, 'noopener noreferrer')
      assert.equal(click(link.props).defaultPrevented, false)
      const note = nodes(tree).find(n=>n.props.id === link.props['aria-describedby'])
      assert.match(text(note), /otra pestaña/)
    }
  }
})

test('PolicyLayout y placeholder presentan un solo conjunto de landmarks, heading y retorno funcional', () => {
  runtime.reset()
  const calls = []
  const navigation = {onCatalogClick:hash=>calls.push(hash), onPolicyNavigate:()=>{}, onCartClick:()=>{}}
  for (const destination of policyDestinations) {
    const tree = expand(PolicyPage({destination, ...navigation}))
    for (const tag of ['header', 'main', 'footer', 'h1']) assert.equal(nodes(tree).filter(n=>n.type === tag).length, 1)
    const heading = nodes(tree).find(n=>n.type === 'h1')
    assert.equal(text(heading), destination.title)
    assert.equal(heading.props.tabIndex, -1)
    assert.equal(heading.props['data-app-heading'], true)
    assert.match(text(tree), /Contenido en preparación/)
    const main = nodes(tree).find(n=>n.type === 'main')
    const link = nodes(main).find(n=>n.type === 'a' && n.props.href === '#catalog')
    assert.equal(click(link.props, {ctrlKey:true}).defaultPrevented, false)
    assert.equal(click(link.props).defaultPrevented, true)
  }
  assert.deepEqual(calls, Array(5).fill('#catalog'))
  const layout = expand(PolicyLayout({title:'Título',introduction:'Introducción',children:'Contenido',...navigation}))
  assert.match(text(layout), /Introducción/)
})

test('secciones y Footers coexistentes mantienen IDs únicos y asociaciones accesibles', () => {
  runtime.reset()
  const tree = [Footer({onPolicyNavigate:()=>{}}), Footer({onCatalogClick:()=>{}}),
    PolicySection({title:'Primera',children:'Texto'}), PolicySection({title:'Segunda',children:'Texto'})]
  const all = nodes(tree), ids = all.filter(n=>n.props.id).map(n=>n.props.id)
  assert.equal(new Set(ids).size, ids.length)
  assert.equal(ids.filter(id=>id === 'about').length, 1)
  for (const node of all.filter(n=>n.props['aria-labelledby'])) assert.ok(ids.includes(node.props['aria-labelledby']))
  const sections = all.filter(n=>n.type === 'section' && text(n).includes('Texto'))
  assert.equal(sections.length, 2)
  for (const section of sections) assert.equal(section.props.children[0].type, 'h2')
})

test('Header informativo mantiene retorno al catálogo y respeta clicks modificados', () => {
  runtime.reset()
  let calls = 0
  const tree = Header({policyView:true, onCatalogClick:()=>calls++})
  const links = nodes(tree).filter(n=>n.type === 'a')
  assert.ok(links.every(n=>n.props.href === '#catalog'))
  for (const link of links) {
    assert.equal(click(link.props, {metaKey:true}).defaultPrevented, false)
    assert.equal(click(link.props).defaultPrevented, true)
  }
  assert.equal(calls, links.length)
})

test('TermsPage reutiliza PolicyLayout, publica cuatro secciones y versión sin consentimiento', () => {
  runtime.reset()
  const calls = []
  const navigation = {onCatalogClick:hash=>calls.push(hash), onPolicyNavigate:()=>{}, onCartClick:()=>{}}
  const component = TermsPage(navigation)
  assert.equal(component.type, PolicyLayout)
  const tree = expand(component)
  for (const tag of ['header','main','footer','h1']) assert.equal(nodes(tree).filter(n=>n.type===tag).length,1)
  assert.equal(text(nodes(tree).find(n=>n.type==='h1')),termsPolicy.title)
  assert.equal(nodes(tree).find(n=>n.type==='h1').props.tabIndex,-1)
  assert.equal(nodes(tree).find(n=>n.type==='time').props.dateTime,termsPolicy.publishedAt)
  assert.match(text(tree), /2026-10-lab4-v1/)
  const required = ['Condiciones de uso del sitio','Condiciones generales de compra','Responsabilidades del cliente','Responsabilidades de CiberNova']
  assert.deepEqual(termsPolicy.sections.map(section=>section.title),required)
  for (const title of required) assert.ok(nodes(tree).some(n=>n.type==='h2' && text(n)===title))
  assert.equal(new Set(termsPolicy.sections.map(section=>section.id)).size,4)
  const body = expand(TermsContent())
  for (const section of termsPolicy.sections) for (const paragraph of section.paragraphs) assert.ok(text(body).includes(paragraph))
  assert.match(text(body), /No realiza cargos/)
  assert.equal(nodes(body).some(n=>['header','footer','main','h1','input','button'].includes(n.type)),false)
  const main=nodes(tree).find(n=>n.type==='main')
  const link=nodes(main).find(n=>n.type==='a' && n.props.href==='#catalog')
  assert.equal(click(link.props,{ctrlKey:true}).defaultPrevented,false)
  assert.equal(click(link.props).defaultPrevented,true)
  assert.deepEqual(calls,['#catalog'])
  const all=nodes(tree), ids=all.filter(n=>n.props.id).map(n=>n.props.id)
  for (const node of all.filter(n=>n.props['aria-labelledby'])) assert.ok(ids.includes(node.props['aria-labelledby']))
})

test('ReturnsPolicyPage publica condiciones, exclusiones y procedimiento académico con PolicyLayout', () => {
  runtime.reset()
  const calls=[]
  const navigation={onCatalogClick:hash=>calls.push(hash),onPolicyNavigate:()=>{},onCartClick:()=>{}}
  const component=ReturnsPolicyPage(navigation)
  assert.equal(component.type,PolicyLayout)
  const tree=expand(component)
  for (const tag of ['header','main','footer','h1']) assert.equal(nodes(tree).filter(n=>n.type===tag).length,1)
  const heading=nodes(tree).find(n=>n.type==='h1')
  assert.equal(text(heading),'Política de Devoluciones')
  assert.equal(heading.props.tabIndex,-1)
  assert.equal(heading.props['data-app-heading'],true)
  assert.equal(returnsPolicy.voluntaryReturnWindowDays,15)
  assert.equal(returnsPolicy.sections.length,4)
  assert.equal(new Set(returnsPolicy.sections.map(section=>section.id)).size,4)
  for (const section of returnsPolicy.sections) {
    assert.ok(nodes(tree).some(n=>n.type==='h2' && text(n)===section.title))
    for (const paragraph of section.paragraphs) assert.ok(text(tree).includes(paragraph))
    for (const item of section.items??[]) assert.ok(text(tree).includes(item))
  }
  assert.match(text(tree),/15 días naturales a partir de la entrega/)
  assert.match(text(tree),/día siguiente a la entrega se cuenta como día 1/)
  assert.match(text(tree),/No limita garantías/)
  assert.match(text(tree),/no existe un canal operativo de devoluciones/)
  assert.match(text(tree),/productos defectuosos/)
  const main=nodes(tree).find(n=>n.type==='main')
  assert.equal(nodes(main).filter(n=>n.type==='ol').length,1)
  assert.equal(nodes(main).some(n=>['form','input','button'].includes(n.type)),false)
  const link=nodes(main).find(n=>n.type==='a' && n.props.href==='#catalog')
  assert.equal(click(link.props,{ctrlKey:true}).defaultPrevented,false)
  assert.equal(click(link.props).defaultPrevented,true)
  assert.deepEqual(calls,['#catalog'])
  const all=nodes(tree),ids=all.filter(n=>n.props.id).map(n=>n.props.id)
  assert.equal(new Set(ids).size,ids.length)
  for (const node of all.filter(n=>n.props['aria-labelledby'])) assert.ok(ids.includes(node.props['aria-labelledby']))
})

test('Footer abre la política real de devoluciones y Back conserva el catálogo', t => {
  const app=environment(t)
  let tree=app.render()
  const footer=Footer({onPolicyNavigate:nodes(tree).find(n=>n.type==='ProductListingPage').props.onPolicyNavigate})
  const link=nodes(footer).find(n=>n.type==='a' && n.props.href==='#returns-policy')
  assert.equal(click(link.props).defaultPrevented,true)
  tree=app.render()
  assert.ok(nodes(tree).find(n=>n.type===ReturnsPolicyPage))
  assert.equal(app.window.location.hash,'#returns-policy')
  assert.equal(app.window.location.pathname,'/Proyecto_Comercio_Electronico/')
  app.travel(-1); tree=app.render()
  assert.equal(nodes(tree).find(n=>n.type==='ProductListingPage').props.active,true)
  app.travel(1); tree=app.render()
  assert.ok(nodes(tree).find(n=>n.type===ReturnsPolicyPage))
})
