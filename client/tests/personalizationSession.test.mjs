/** SessionProvider, ProductListing y SearchBox reales: aislamiento de Recent Searches. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { analyticsEnvironment, loadAnalytics, dataUrl } from './helpers/analyticsHarness.mjs'
import { reactHarness, nodes, label } from './helpers/reactHarness.mjs'

test('Recent Searches conserva cancelación, limpia cambio/Logout/reload y nunca persiste el query',async t=>{
  const h=await reactHarness()
  t.after(()=>h.runtime.dispose())
  const {stored}=analyticsEnvironment(t)
  const {api,url}=await loadAnalytics()
  h.overrides.set('services/analytics',url)
  h.overrides.set('context/SessionContext',dataUrl('export const SessionContext={Provider:"SessionProvider"}'))
  const bridgeUrl=dataUrl('let state;export function setSession(value){state=value}export function useSession(){return state}')
  const bridge=await import(bridgeUrl)
  h.overrides.set('hooks/useSession',bridgeUrl)
  h.overrides.set('hooks/useProductCatalog',dataUrl('export function useProductCatalog(){return {products:[],totalPages:1,nbHits:0,facets:{},isLoading:false,error:null}}'))
  for(const name of ['CartFeedbackToast','CatalogFilters','CatalogHero','CatalogToolbar','Pagination','ProductGrid','ProductQuickView','RecentlyViewedProducts'])h.overrides.set('components/catalog/'+name,dataUrl("export default '"+name+"'"))
  for(const name of ['Header','Footer'])h.overrides.set('components/layout/'+name,dataUrl("export default '"+name+"'"))
  let cart=[],revision=0
  h.runtime.setCart({getSnapshot:()=>({items:cart,revision,hasExternalConflict:false}),hasExternalConflict:false,clearCart(){cart=[];revision++}})
  const profiles=[{id:'c',displayName:'Cliente',role:'B2C'},{id:'b',displayName:'Empresa',role:'B2B',company:{id:'co',name:'Empresa Demo'}}]
  t.mock.method(globalThis,'fetch',async(path,options)=>{
    assert.equal(path,'/api/session/resolve')
    return Response.json({user:profiles.find(profile=>profile.id===JSON.parse(options.body).userId)})
  })
  const previousDoc=Object.getOwnPropertyDescriptor(globalThis,'document')
  Object.defineProperty(globalThis,'document',{configurable:true,value:{addEventListener(){},removeEventListener(){}}})
  t.after(()=>{if(previousDoc)Object.defineProperty(globalThis,'document',previousDoc);else delete globalThis.document})
  const {default:Provider}=await h.load('context/SessionProvider')
  const {default:Listing}=await h.load('pages/ProductListingPage')
  const {default:Search}=await h.load('components/catalog/SearchBox')
  const queries=new Map()
  const session=()=>{
    const value=h.render('session',Provider,{children:null},false).props.value
    bridge.setSession(value)
    h.runtime.commit('session')
    return value
  }
  const search=()=>{
    const page=h.render('listing',Listing,{active:true,isCartPreviewOpen:false,onCartClick(){},onProductAdded(){},onPolicyNavigate(){}})
    const key=nodes(page).find(node=>node.type==='CatalogToolbar').key
    const props={query:queries.get(key)??'',results:[],isLoading:false,error:null,onSelectResult(){},onQueryChange:value=>queries.set(key,value)}
    return {key,tree:h.render('search:'+key,Search,props)}
  }
  const remember=query=>{
    const {key}=search();queries.set(key,query)
    let {tree}=search()
    nodes(tree).find(node=>node.type==='input').props.onKeyDown({key:'Enter',currentTarget:{value:query},preventDefault(){}})
    queries.set(key,'')
    tree=search().tree
    nodes(tree).find(node=>node.type==='input').props.onClick()
    return search().tree
  }
  const login=async id=>{session().openLogin();await session().resolveUser(id);return session()}
  await login('c')
  assert.match(label(remember('consulta-solo-memoria')),/consulta-solo-memoria/)
  const oldKey=search().key
  cart=[{productId:'p',quantity:1}];revision++
  const pending=await login('b')
  assert.ok(pending.pending)
  assert.equal(pending.user.id,'c')
  pending.cancelTransition();session()
  assert.equal(search().key,oldKey)
  assert.match(label(search().tree),/consulta-solo-memoria/)
  const confirmed=await login('b')
  confirmed.confirmTransition(confirmed.pending.cartRevision);session()
  assert.notEqual(search().key,oldKey)
  assert.doesNotMatch(label(search().tree),/consulta-solo-memoria/)
  assert.match(label(remember('consulta-b')),/consulta-b/)
  session().requestLogout();assert.equal(session().user,null)
  assert.doesNotMatch(label(search().tree),/consulta-b/)
  await login('b')
  assert.match(label(remember('consulta-antes-reload')),/consulta-antes-reload/)
  await api.flushAnalytics()
  assert.equal([...stored.values()].some(raw=>/consulta-/.test(raw)),false)
  h.runtime.dispose();queries.clear()
  assert.equal(session().user,null)
  assert.doesNotMatch(label(search().tree),/consulta-/)
})
