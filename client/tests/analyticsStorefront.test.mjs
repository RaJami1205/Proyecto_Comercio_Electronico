import test from 'node:test'
import assert from 'node:assert/strict'
import { analyticsEnvironment, loadAnalytics, dataUrl } from './helpers/analyticsHarness.mjs'
import { reactHarness, nodes } from './helpers/reactHarness.mjs'

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

const product = { id:'p', name:'Producto', image:'', price:10000, inStock:true }

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
