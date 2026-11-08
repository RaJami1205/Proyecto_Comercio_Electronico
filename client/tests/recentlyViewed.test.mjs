/** Componente real + Analytics v2 + Product API real; storage, locks y fetch aislados. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { analyticsEnvironment, loadAnalytics, event, dataUrl } from './helpers/analyticsHarness.mjs'
import { reactHarness, nodes, label } from './helpers/reactHarness.mjs'

const product = id => ({id,name:'Producto '+id,image:'/ssd.png',price:10000.125,category:'Almacenamiento',
  inStock:true,description:'Actual',specifications:[{label:'Capacidad',value:'2 TB'}]})
const deferred = () => {let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no});return {promise,resolve,reject}}
const tick = () => new Promise(resolve=>setImmediate(resolve))
const cards = tree => nodes(tree).filter(node=>node.type==='button'&&label(node).trim().startsWith('Producto '))
const cardLabel = card => label(nodes(card).find(node=>node.type==='span'))
const action = (tree,name) => nodes(tree).find(node=>node.type==='button'&&label(node)===name).props

async function historyFlow(t, userId='u') {
  const h=await reactHarness()
  const runtimes=[h.runtime]
  t.after(()=>runtimes.forEach(runtime=>runtime.dispose()))
  const env=analyticsEnvironment(t)
  const {api,url}=await loadAnalytics()
  h.overrides.set('services/analytics',url)
  const {default:History}=await h.load('components/catalog/RecentlyViewedProducts')
  const listeners=new Map()
  window.addEventListener=(name,callback)=>{if(!listeners.has(name))listeners.set(name,new Set());listeners.get(name).add(callback)}
  window.removeEventListener=(name,callback)=>listeners.get(name)?.delete(callback)
  const fire=(name,value)=>listeners.get(name)?.forEach(callback=>callback(value))
  env.listeners.add(value=>fire(value.type,value))
  const calls=[],opened=[]
  let respond=ids=>Response.json({products:ids.map(product)})
  t.mock.method(globalThis,'fetch',async url=>{
    const request=new URL(String(url),'http://local.test')
    assert.equal(request.pathname,'/api/products','solo resolución aislada')
    const ids=request.searchParams.getAll('ids')
    calls.push(ids)
    return respond(ids)
  })
  let props={userId,onProductSelect:value=>opened.push(value)}
  const render=()=>h.render('history',History,props)
  const settle=async()=>{await api.flushAnalytics();await tick();return render()}
  return {...h,...env,api,calls,opened,fire,renderComponent:h.render,render,settle,
    view(id,owner=props.userId){api.trackEvent(event('PRODUCT_VIEWED',{productId:id}),owner)},
    setOwner(owner){props={...props,userId:owner};return render()},
    setProps(value){props=value;return render()},
    respond(callback){respond=callback},
    async reload(){
      h.runtime.dispose()
      const fresh=await reactHarness()
      runtimes.push(fresh.runtime)
      const {api:reloaded,url}=await loadAnalytics()
      fresh.overrides.set('services/analytics',url)
      const {default:ReloadHistory}=await fresh.load('components/catalog/RecentlyViewedProducts')
      const draw=()=>fresh.render('history',ReloadHistory,props)
      draw();await tick()
      return {api:reloaded,tree:draw()}
    },
  }
}

test('sin historial es discreto y no solicita productos; deleted muestra Empty',async t=>{
  const f=await historyFlow(t)
  assert.equal(f.render(),null)
  assert.equal(await f.settle(),null)
  assert.equal(f.calls.length,0)
  f.respond(()=>Response.json({products:[]}))
  f.view('missing')
  assert.equal(f.render().props['aria-busy'],true)
  const empty=await f.settle()
  assert.match(label(empty),/ya no están disponibles/)
  assert.equal(cards(empty).length,0)
  assert.ok(action(empty,'Actualizar'))
})

test('Product View real abre Quick View, actualiza historial y no registra por render',async t=>{
  const f=await historyFlow(t)
  f.overrides.set('hooks/useProductCatalog',dataUrl('export function useProductCatalog(){return {products:[{id:"p1"}],totalPages:1,nbHits:1,facets:{},isLoading:false,error:null}}'))
  for(const name of ['CartFeedbackToast','CatalogFilters','CatalogHero','CatalogToolbar','Pagination','ProductGrid','ProductQuickView'])f.overrides.set('components/catalog/'+name,dataUrl("export default '"+name+"'"))
  for(const name of ['Header','Footer'])f.overrides.set('components/layout/'+name,dataUrl("export default '"+name+"'"))
  const {default:Page}=await f.load('pages/ProductListingPage')
  const props={active:true,isCartPreviewOpen:false,onCartClick(){},onProductAdded(){},onPolicyNavigate(){}}
  const listing=()=>f.renderComponent('listing',Page,props)
  let tree=listing()
  const history=nodes(tree).find(node=>node.type.name==='RecentlyViewedProducts')
  f.setProps(history.props)
  assert.equal(f.api.getAnalyticsCounters('u').productViews,0)
  nodes(tree).find(node=>node.type==='ProductGrid').props.onProductSelect(product('p1'))
  const visible=await f.settle()
  assert.equal(cards(visible).length,1)
  assert.equal(f.api.getAnalyticsCounters('u').productViews,1)
  const calls=f.calls.length
  cards(visible)[0].props.onClick()
  tree=listing()
  assert.ok(nodes(tree).find(node=>node.type==='ProductQuickView'))
  assert.equal(f.api.getAnalyticsCounters('u').productViews,2)
  assert.deepEqual(f.api.getRecentlyViewedProductIds('u'),['p1'])
  f.render();f.render()
  assert.equal(f.calls.length,calls,'misma lista ordenada no se vuelve a resolver')
  await f.api.flushAnalytics()
})

test('recencia, dedup, diez productos, schema v2, reload y más de 500 eventos',async t=>{
  const f=await historyFlow(t)
  f.render()
  for(const id of ['p1','p2','p1'])f.view(id)
  let tree=await f.settle()
  assert.deepEqual(cards(tree).map(cardLabel),['Producto p1','Producto p2'])
  assert.equal(f.api.getAnalyticsCounters('u').productViews,3)
  for(let i=3;i<=13;i++)f.view('p'+i)
  tree=await f.settle()
  const expected=Array.from({length:10},(_,i)=>'Producto p'+(13-i))
  assert.deepEqual(cards(tree).map(cardLabel),expected)
  const calls=f.calls.length
  for(let i=0;i<507;i++)f.api.trackEvent(event('SEARCH_PERFORMED',{source:'catalog'}),'u')
  await f.api.flushAnalytics()
  assert.equal(f.api.getAnalyticsEvents('u').length,500)
  assert.equal(f.api.getAnalyticsEvents('u').some(value=>value.type==='PRODUCT_VIEWED'),false)
  assert.equal(f.calls.length,calls)
  const raw=JSON.parse(f.stored.get(f.api.analyticsStorage.keyPrefix+'user:u'))
  assert.equal(raw.schemaVersion,2)
  assert.equal(raw.userId,'u')
  const reload=await f.reload()
  assert.deepEqual(cards(reload.tree).map(cardLabel),expected)
  assert.equal(reload.api.getAnalyticsCounters('u').productViews,14)
})

test('aislamiento B2C → B2B → ADMIN, Logout y nueva selección; anónimo no se transfiere',async t=>{
  const f=await historyFlow(t,'c')
  f.view('consumer','c');f.view('business','b');f.view('admin','a');f.view('anonymous',null)
  f.render()
  assert.deepEqual(cards(await f.settle()).map(cardLabel),['Producto consumer'])
  for(const [id,name] of [['b','business'],['a','admin'],[undefined,'anonymous'],['c','consumer']]){
    const transition=f.setOwner(id)
    assert.equal(cards(transition).length,0,'el render de transición no expone el owner anterior')
    assert.deepEqual(cards(await f.settle()).map(cardLabel),['Producto '+name])
  }
  assert.deepEqual(f.api.getRecentlyViewedProductIds('new-user'),[])
  assert.deepEqual(f.api.getRecentlyViewedProductIds(),['anonymous'])
})

test('ignora respuesta tardía de otro owner y cambios de historial fuera de orden',async t=>{
  const f=await historyFlow(t,'a')
  const old=deferred()
  f.respond(ids=>ids[0]==='old'?old.promise:Response.json({products:ids.map(product)}))
  f.view('old','a');f.view('new','b')
  f.render();f.setOwner('b')
  assert.deepEqual(cards(await f.settle()).map(cardLabel),['Producto new'])
  old.resolve(Response.json({products:[product('old')]}));await tick()
  assert.deepEqual(cards(f.render()).map(cardLabel),['Producto new'])
  const first=deferred()
  f.respond(ids=>ids[0]==='first'?first.promise:Response.json({products:ids.map(product)}))
  f.view('first','b');f.view('second','b')
  assert.deepEqual(cards(await f.settle()).map(cardLabel),['Producto second','Producto first','Producto new'])
  first.resolve(Response.json({products:[product('first'),product('new')]}));await tick()
  assert.deepEqual(cards(f.render()).map(cardLabel),['Producto second','Producto first','Producto new'])
})

for(const failure of ['network','malformed','http'])test('Error y Retry ante '+failure+' sin render crash',async t=>{
  const f=await historyFlow(t)
  f.respond(()=>{
    if(failure==='network')throw new Error('offline')
    return failure==='http'?Response.json({error:'failed'},{status:503}):Response.json({products:null})
  })
  f.view('p1');f.render()
  const error=await f.settle()
  assert.equal(nodes(error).some(node=>node.props?.role==='alert'),true)
  assert.equal(cards(error).length,0)
  f.respond(ids=>Response.json({products:ids.map(product)}))
  action(error,'Reintentar').onClick()
  assert.equal(f.render().props['aria-busy'],true)
  const success=await f.settle()
  assert.equal(cards(success).length,1)
  assert.equal(nodes(success).some(node=>node.props?.role==='alert'),false)
  assert.equal(f.calls.length,2)
})

test('Refresh conserva productos seguros durante Loading/Error y recupera precios actuales sin persistirlos',async t=>{
  const f=await historyFlow(t)
  f.view('p1');f.render()
  let tree=await f.settle()
  f.respond(()=>{throw new Error('offline')})
  action(tree,'Actualizar').onClick()
  assert.equal(cards(f.render()).length,1)
  tree=await f.settle()
  assert.match(label(tree),/última consulta/)
  assert.equal(cards(tree).length,1)
  f.respond(ids=>Response.json({products:ids.map(id=>({...product(id),price:12345.678}))}))
  action(tree,'Reintentar').onClick()
  cards(await f.settle())[0].props.onClick()
  assert.equal(f.opened[0].price,12345.678)
  assert.equal([...f.stored.values()].some(raw=>raw.includes('12345.678')),false)
})

test('solo refetch por owner/orden/IDs o Refresh; storage de otro scope se ignora',async t=>{
  const f=await historyFlow(t)
  f.view('p1');f.render();await f.settle()
  const calls=f.calls.length
  for(const input of [event('SEARCH_PERFORMED',{source:'catalog'}),event('CART_ITEM_ADDED',{productId:'p1',quantity:1}),event('CHECKOUT_STARTED'),event('PURCHASE_COMPLETED',{orderId:'o'})])f.api.trackEvent(input,'u')
  f.view('other','another-user');await f.api.flushAnalytics()
  f.fire('storage',{key:f.api.analyticsStorage.keyPrefix+'user:another-user'})
  f.fire('storage',{key:f.api.analyticsStorage.keyPrefix+'user:u'})
  await f.settle()
  assert.equal(f.calls.length,calls)
  const {api:tab}=await loadAnalytics()
  tab.trackEvent(event('PRODUCT_VIEWED',{productId:'p2'}),'u')
  await tab.flushAnalytics()
  f.fire('storage',{key:f.api.analyticsStorage.keyPrefix+'user:u'})
  assert.deepEqual(cards(await f.settle()).map(cardLabel),['Producto p2','Producto p1'])
  assert.equal(f.calls.length,calls+1)
  tab.trackEvent(event('PRODUCT_VIEWED',{productId:'p1'}),'u')
  await tab.flushAnalytics()
  f.fire('storage',{key:f.api.analyticsStorage.keyPrefix+'user:u'})
  const tree=await f.settle()
  assert.deepEqual(cards(tree).map(cardLabel),['Producto p1','Producto p2'])
  assert.equal(f.calls.length,calls+2)
  action(tree,'Actualizar').onClick();await f.settle()
  assert.equal(f.calls.length,calls+3)
})

test('storage corrupto o bloqueado no rompe personalización ni reatribuye datos',async t=>{
  const f=await historyFlow(t)
  f.stored.set(f.api.analyticsStorage.keyPrefix+'user:u','{')
  assert.equal(f.render(),null)
  assert.equal(f.calls.length,0)
  f.storage.getItem=()=>{throw new Error('blocked')}
  f.view('p1')
  assert.deepEqual(cards(await f.settle()).map(cardLabel),['Producto p1'])
})
