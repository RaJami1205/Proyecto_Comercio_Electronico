import test from 'node:test'
import assert from 'node:assert/strict'
import { analyticsEnvironment, loadAnalytics, dataUrl } from './helpers/analyticsHarness.mjs'
import { reactHarness, nodes, label } from './helpers/reactHarness.mjs'

async function setup(t) {
  const h = await reactHarness()
  t.after(()=>h.runtime.dispose())
  const env = analyticsEnvironment(t)
  const { api, url } = await loadAnalytics()
  h.overrides.set('services/analytics', url)
  for (const name of ['ProductListingPage','CartPage','CheckoutPage','PolicyPlaceholderPage','TermsPage','ReturnsPolicyPage','FaqPage','AnalyticsDashboardPage']) h.overrides.set('pages/' + name, dataUrl(`export default '${name}'`))
  for (const name of ['ShippingPolicyPage','PrivacyPolicyPage']) h.overrides.set('pages/' + name, dataUrl(`export const ${name} = '${name}'`))
  h.overrides.set('context/CartContext', dataUrl('export const CartContext={Provider:"CartProvider"}'))
  h.overrides.set('components/cart/CartPreviewDrawer', dataUrl('export default "CartPreviewDrawer"'))
  h.overrides.set('components/session/LoginDialog', dataUrl('export default "LoginDialog"'))
  const listeners = new Map()
  window.addEventListener = (type, callback) => listeners.set(type, callback)
  window.removeEventListener = type => listeners.delete(type)
  window.setTimeout = () => 1
  window.location = new URL('https://local.test/#catalog')
  window.history = { pushState(_state,_unused,url) { window.location = new URL(url,window.location) }, replaceState(_state,_unused,url) { window.location = new URL(url,window.location) } }
  t.mock.method(globalThis, 'setTimeout', () => 1)
  t.mock.method(globalThis, 'clearTimeout', () => {})
  const previousRaf=globalThis.requestAnimationFrame, previousCancel=globalThis.cancelAnimationFrame
  globalThis.requestAnimationFrame=()=>1;globalThis.cancelAnimationFrame=()=>{}
  t.after(()=>{globalThis.requestAnimationFrame=previousRaf;globalThis.cancelAnimationFrame=previousCancel})
  return { ...h, ...env, api, listeners }
}

const product = { id:'p', name:'Producto', image:'', price:10000, retailPrice:10000,
  pricing:{type:'RETAIL',eligible:true,minOrderQuantity:1,message:null},
  inventory:{branchId:null,quantity:null,status:'unselected',canFulfillMinimum:null,message:'Selecciona una sucursal.'},
  canAddToCart:true, inStock:true }

test('App registra Cart Add después del Provider real; hidratación/remove/cleanup/storage no emiten', async t => {
  const h = await setup(t)
  const { default: CartProvider } = await h.load('context/CartProvider')
  const { default: App } = await h.load('App')
  const { default: Card } = await h.load('components/catalog/ProductCard')
  const sync = () => h.runtime.setCart(h.render('cart', CartProvider, {children:null}).props.value)
  h.stored.set('cibernova:cart:v1', JSON.stringify({items:[{productId:'hydrated',name:'Previo',image:'',price:100,quantity:1}]}))
  sync()
  assert.equal(h.runtime.cartContext.items[0].productId,'hydrated')
  let app = h.render('app', App)
  const added = nodes(app).find(node=>node.type==='ProductListingPage').props.onProductAdded
  const tree = h.render('card', Card, {product,onProductSelect(){},onProductAdded: value=>added(value,'catalog')})
  assert.equal(h.api.getAnalyticsCounters('u').cartAdds, 0)
  nodes(tree).find(node=>node.type==='button' && /Agregar/.test(node.props['aria-label'])).props.onClick()
  sync()
  assert.equal(h.runtime.cartContext.items.find(item=>item.productId==='p').quantity, 1)
  assert.equal(h.api.getAnalyticsCounters('u').cartAdds, 1)
  h.render('card', Card, {product,onProductSelect(){},onProductAdded: value=>added(value,'catalog')})
  const baseline = h.runtime.cartContext.getSnapshot().items
  h.runtime.cartContext.cleanupPurchase({baseline,purchased:[{productId:'p',quantity:1}]})
  h.runtime.cartContext.removeItem('hydrated')
  h.listeners.get('storage')({key:'cibernova:cart:v1'})
  sync(); app=h.render('app',App)
  assert.equal(h.api.getAnalyticsCounters('u').cartAdds, 1)
  assert.equal(h.api.getAnalyticsEvents('u')[0].metadata.quantity, 1)
  await h.api.flushAnalytics()
})

test('ProductListing abre Quick View desde la interacción y no desde render de Cards', async t => {
  const h = await setup(t)
  h.overrides.delete('pages/ProductListingPage')
  h.overrides.set('hooks/useProductCatalog', dataUrl('export function useProductCatalog(){return {products:[{id:"p"}],totalPages:1,nbHits:1,facets:{},isLoading:false,error:null}}'))
  for(const name of ['CartFeedbackToast','CatalogFilters','CatalogHero','CatalogToolbar','Pagination','ProductGrid','ProductQuickView','RecentlyViewedProducts'])h.overrides.set('components/catalog/'+name,dataUrl(`export default '${name}'`))
  for(const name of ['Header','Footer'])h.overrides.set('components/layout/'+name,dataUrl(`export default '${name}'`))
  const { default: Page } = await h.load('pages/ProductListingPage')
  const props = {active:true,isCartPreviewOpen:false,onCartClick(){},onProductAdded(){},onPolicyNavigate(){}}
  let tree=h.render('catalog',Page,props)
  h.render('catalog',Page,props)
  assert.equal(h.api.getAnalyticsCounters('u').productViews,0)
  nodes(tree).find(node=>node.type==='ProductGrid').props.onProductSelect(product)
  tree=h.render('catalog',Page,props)
  assert.ok(nodes(tree).find(node=>node.type==='ProductQuickView'))
  h.render('catalog',Page,props)
  assert.equal(h.api.getAnalyticsCounters('u').productViews,1)
  await h.api.flushAnalytics()
})

for (const user of [null,{id:'u',role:'B2B'},{id:'u',role:'ADMIN'},{id:'u',role:'B2C'}]) test('Checkout Started respeta navegación real y roles: '+(user?.role??'anonymous'), async t => {
  const h=await setup(t)
  h.runtime.setCart({items:[{productId:'p',quantity:1}],hasExternalConflict:false})
  h.runtime.setUser(user)
  window.location=new URL('https://local.test/'+(user?.role==='B2C'?'#cart-page':'#checkout'))
  const {default:App}=await h.load('App')
  let tree=h.render('app',App)
  nodes(tree).find(node=>node.type==='CartPage').props.onCheckoutRequested()
  tree=h.render('app',App,{},false)
  const effects=h.runtime.commit('app')
  effects.forEach(effect=>effect())
  h.render('app',App)
  assert.equal(nodes(tree).some(node=>node.type==='CheckoutPage'),user?.role==='B2C')
  assert.equal(h.api.getAnalyticsCounters('u').checkouts,user?.role==='B2C'?1:0)
  assert.equal(h.api.getAnalyticsCounters().checkouts,0)
  await h.api.flushAnalytics()
})

test('Checkout directo con carrito vacío no genera Analytics', async t => {
  const h=await setup(t)
  h.runtime.setCart({items:[],hasExternalConflict:false})
  window.location=new URL('https://local.test/#checkout')
  const {default:App}=await h.load('App')
  const tree=h.render('app',App)
  assert.equal(nodes(tree).some(node=>node.type==='CheckoutPage'),false)
  assert.equal(h.api.getAnalyticsCounters('u').checkouts,0)
  await h.api.flushAnalytics()
})

const commercialProduct = (patch = {}) => ({ ...product, category: 'Almacenamiento', description: '', specifications: [],
  inventory: { branchId: 'san_jose', quantity: 3, status: 'available', canFulfillMinimum: true, message: '3 unidades disponibles.' }, ...patch })
const addControl = tree => nodes(tree).find(node => node.type === 'button' && typeof node.props.title === 'string').props

/** Provider/reducer, consumidores, callback de App y collector reales; DOM/storage/reloj simulados. */
async function additions(t, component, candidate = commercialProduct(), initialItems = []) {
  const h = await setup(t)
  h.stored.set('cibernova:cart:v1', JSON.stringify({ schemaVersion: 2, ownerId: 'u', items: initialItems }))
  const previousDocument = Object.getOwnPropertyDescriptor(globalThis, 'document')
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { addEventListener() {}, removeEventListener() {} } })
  t.after(() => {
    if (previousDocument) Object.defineProperty(globalThis, 'document', previousDocument)
    else delete globalThis.document
  })
  h.overrides.set('components/catalog/CartFeedbackToast', dataUrl('export default "CartFeedbackToast"'))
  const { default: Provider } = await h.load('context/CartProvider')
  const { default: App } = await h.load('App')
  const { default: Control } = await h.load('components/catalog/' + component)
  const sync = () => h.runtime.setCart(h.render('cart', Provider, { children: null }).props.value)
  sync()
  assert.equal(h.runtime.cartContext.setCartOwner('u'), true)
  const feedback = []
  let tree
  const onClose = () => {}, onProductSelect = () => {}
  function render() {
    sync()
    const app = h.render('app', App)
    const page = nodes(app).find(node => node.type === 'ProductListingPage').props
    tree = h.render('addition', Control, { product: candidate, onClose, onProductSelect,
      addedProductId: page.feedback?.productId,
      feedbackProductName: page.feedback?.source === 'quick-view' ? page.feedback.productName : undefined,
      onProductAdded(value) { feedback.push(value); page.onProductAdded(value, component === 'ProductQuickView' ? 'quick-view' : 'catalog') },
    })
    return tree
  }
  render()
  return { ...h, render, feedback, get tree() { return tree },
    cart: () => h.runtime.cartContext,
    snapshot: () => h.runtime.cartContext.getSnapshot(),
    click(times = 1) { const handler = addControl(tree).onClick; for (let index = 0; index < times; index++) handler() },
    changeUser(user) {
      h.runtime.cartContext.clearCart()
      assert.equal(h.runtime.cartContext.setCartOwner(user.id), true)
      h.runtime.setUser(user)
      return render()
    },
  }
}

for (const component of ['ProductCard', 'ProductQuickView']) {
  test(component + ': producto nuevo e incremento aceptados registran una acción cada uno', async t => {
    const f = await additions(t, component)
    f.click()
    assert.equal(f.snapshot().items[0].quantity, 1, 'La transición inmediata ya existe antes del render.')
    const lineage = structuredClone(f.snapshot().items[0].lineage)
    f.click()
    assert.equal(f.snapshot().items[0].quantity, 2)
    assert.deepEqual(f.snapshot().items[0].lineage, lineage)
    assert.equal(f.feedback.length, 2)
    assert.equal(f.api.getAnalyticsCounters('u').cartAdds, 2)
    assert.equal(f.api.getAnalyticsCounters().cartAdds, 0)
    assert.equal(f.api.getAnalyticsEvents('u').filter(event => event.type === 'CART_ITEM_ADDED').length, 2)
    await f.api.flushAnalytics()
  })

  test(component + ': pulsaciones rápidas hasta stock solo cuentan y notifican las aceptadas', async t => {
    const f = await additions(t, component)
    f.click(5) // Usa el mismo handler y no espera el render de React entre pulsaciones.
    assert.equal(f.snapshot().items[0].quantity, 3)
    assert.equal(f.feedback.length, 3)
    assert.equal(f.api.getAnalyticsCounters('u').cartAdds, 3)
    assert.match(label(f.render()), /alcanzaste el stock disponible/)
    assert.ok(nodes(f.tree).some(node => node.props?.role === 'alert'))
    assert.equal(nodes(f.tree).some(node => node.type === 'CartFeedbackToast'), false)
    assert.deepEqual(f.api.getAnalyticsEvents('u').map(event => event.metadata), Array.from({ length: 3 }, () => ({ productId: 'p', quantity: 1 })))
    await f.api.flushAnalytics()
  })

  test(component + ': rechazo sobre Cart restaurado al límite no produce ningún evento ni éxito', async t => {
    const existing = { productId: 'p', name: 'Producto', image: '', price: 10000, quantity: 3, availableQuantity: 3 }
    const f = await additions(t, component, commercialProduct(), [existing])
    const before = structuredClone(f.snapshot().items)
    f.click()
    assert.deepEqual(f.snapshot().items, before)
    assert.equal(f.feedback.length, 0)
    assert.equal(f.api.getAnalyticsCounters('u').cartAdds, 0)
    assert.deepEqual(f.api.getAnalyticsEvents('u'), [])
    assert.match(label(f.render()), /stock disponible/)
    await f.api.flushAnalytics()
  })

  test(component + ': un nuevo rechazo conserva la línea y un éxito posterior limpia el mensaje', async t => {
    const f = await additions(t, component)
    f.click(3); f.render()
    f.click()
    assert.match(label(f.render()), /stock disponible/)
    const before = structuredClone(f.snapshot().items[0])
    f.cart().updateProductContext('p', { availableQuantity: 4 })
    f.render(); f.click()
    assert.equal(f.snapshot().items[0].quantity, 4)
    assert.deepEqual(f.snapshot().items[0].lineage, before.lineage)
    assert.equal(nodes(f.render()).some(node => node.props?.role === 'alert'), false)
    assert.equal(f.feedback.length, 4)
    assert.equal(f.api.getAnalyticsCounters('u').cartAdds, 4)
    await f.api.flushAnalytics()
  })

  test(component + ': producto no elegible conserva su bloqueo comercial sin éxito ni Analytics', async t => {
    const f = await additions(t, component, commercialProduct({ canAddToCart: false, price: null,
      pricing: { type: null, eligible: false, minOrderQuantity: null, message: 'Producto no habilitado para este contexto comercial.' } }))
    assert.equal(addControl(f.tree).disabled, true)
    f.click() // El handler también protege una invocación programática del control deshabilitado.
    assert.deepEqual(f.snapshot().items, [])
    assert.equal(f.feedback.length, 0)
    assert.equal(f.api.getAnalyticsCounters('u').cartAdds, 0)
    assert.match(label(f.render()), /no habilitado para este contexto comercial/)
    await f.api.flushAnalytics()
  })

  test(component + ': cambio de Session aísla scope y rechaza callbacks de la identidad anterior', async t => {
    const f = await additions(t, component)
    const previousHandler = addControl(f.tree).onClick
    f.click()
    f.changeUser({ id: 'other', role: 'B2C' })
    previousHandler()
    assert.deepEqual(f.snapshot().items, [])
    assert.equal(f.feedback.length, 1)
    assert.equal(f.api.getAnalyticsCounters('u').cartAdds, 1)
    assert.equal(f.api.getAnalyticsCounters('other').cartAdds, 0)
    f.render(); f.click()
    assert.equal(f.snapshot().ownerId, 'other')
    assert.equal(f.snapshot().items[0].quantity, 1)
    assert.equal(f.feedback.length, 2)
    assert.equal(f.api.getAnalyticsCounters('u').cartAdds, 1)
    assert.equal(f.api.getAnalyticsCounters('other').cartAdds, 1)
    assert.equal(f.api.getAnalyticsCounters().cartAdds, 0)
    await f.api.flushAnalytics()
    assert.equal(f.api.getAnalyticsEvents('u')[0].userId, 'u')
    assert.equal(f.api.getAnalyticsEvents('other')[0].userId, 'other')
    const aggregate = f.api.getAggregateAnalyticsSnapshot()
    assert.equal(aggregate.status, 'ready')
    assert.equal(aggregate.counters.cartAdds, 2)
  })

  test(component + ': la incorporación mayorista mínima cuenta una acción, conservando metadata v2', async t => {
    const f = await additions(t, component, commercialProduct({ price: 800,
      pricing: { type: 'WHOLESALE', eligible: true, minOrderQuantity: 3, message: null } }))
    f.changeUser({ id: 'business', role: 'B2B', company: { id: 'co', name: 'Empresa ficticia' } })
    f.click(); f.click()
    assert.equal(f.snapshot().items[0].quantity, 3)
    assert.equal(f.snapshot().items[0].price, 800)
    assert.equal(f.feedback.length, 1)
    assert.equal(f.api.getAnalyticsCounters('business').cartAdds, 1)
    const event = f.api.getAnalyticsEvents('business')[0]
    assert.equal(event.schemaVersion, 2)
    assert.deepEqual(event.metadata, { productId: 'p', quantity: 1 })
    await f.api.flushAnalytics()
  })
}

test('Provider devuelve aceptación real y motivos de rechazo bajo las reglas existentes', async t => {
  const f = await additions(t, 'ProductCard')
  const item = { productId: 'direct', name: 'Directo', image: '', price: 800, minimumOrderQuantity: 3, availableQuantity: 5 }
  for (const initialQuantity of [1, 2, 1.5]) {
    const result = f.cart().addItem({ ...item, initialQuantity })
    assert.equal(result.accepted, false)
    assert.match(result.message, /mínimo de compra/)
    assert.deepEqual(f.snapshot().items, [])
  }
  const stock = f.cart().addItem({ ...item, initialQuantity: 6 })
  assert.equal(stock.accepted, false); assert.match(stock.message, /stock suficiente/)
  assert.deepEqual(f.cart().addItem({ ...item, initialQuantity: 3 }), { accepted: true })
  assert.equal(f.snapshot().items[0].quantity, 3)
  assert.deepEqual(f.cart().addItem(item), { accepted: true })
  assert.equal(f.snapshot().items[0].quantity, 4)
  const previous = f.cart()
  previous.setCartOwner(null)
  const inactive = previous.addItem(item)
  assert.equal(inactive.accepted, false); assert.match(inactive.message, /identidad propietaria/)
  assert.equal(f.snapshot().items[0].quantity, 4)
  await f.api.flushAnalytics()
})
