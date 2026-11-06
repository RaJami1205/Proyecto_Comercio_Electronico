import test from 'node:test'
import assert from 'node:assert/strict'
import { analyticsEnvironment, loadAnalytics, dataUrl } from './helpers/analyticsHarness.mjs'
import { reactHarness, nodes, label } from './helpers/reactHarness.mjs'

async function searchFlow(t) {
  const h=await reactHarness()
  t.after(()=>h.runtime.dispose())
  analyticsEnvironment(t)
  const {api,url}=await loadAnalytics()
  h.overrides.set('services/analytics',url)
  const apiUrl=dataUrl(`
    export const catalog=[],autocomplete=[];
    export async function getCatalogPage(page,size,filters,query){catalog.push({page,size,filters,query});return {products:[],totalPages:1,totalProducts:0,facets:{}};}
    export async function searchProducts(query){autocomplete.push(query);return [{id:'p',name:'Producto',image:'',price:100,inStock:true}];}
  `)
  h.overrides.set('services/productApi',apiUrl)
  const calls=await import(apiUrl)
  const {default:Toolbar}=await h.load('components/catalog/CatalogToolbar')
  const {default:SearchBox}=await h.load('components/catalog/SearchBox')
  const {useProductCatalog}=await h.load('hooks/useProductCatalog')
  let now=0,id=0,query='',source='catalog',page=1,filters={},selected=0,tree
  const timers=new Map()
  t.mock.method(globalThis,'setTimeout',(callback,delay)=>{timers.set(++id,{at:now+delay,callback});return id})
  t.mock.method(globalThis,'clearTimeout',id=>timers.delete(id))
  const previousDoc=Object.getOwnPropertyDescriptor(globalThis,'document'),previousInput=Object.getOwnPropertyDescriptor(globalThis,'InputEvent')
  Object.defineProperty(globalThis,'document',{configurable:true,value:{addEventListener(){},removeEventListener(){},activeElement:null}})
  Object.defineProperty(globalThis,'InputEvent',{configurable:true,value:class InputEvent {}})
  t.after(()=>{
    if(previousDoc)Object.defineProperty(globalThis,'document',previousDoc);else delete globalThis.document
    if(previousInput)Object.defineProperty(globalThis,'InputEvent',previousInput);else delete globalThis.InputEvent
  })
  const props={productCount:0,activePanel:null,onTogglePanel(){},onProductSelect(){selected++},
    onSearchChange(next,nextSource){if(query!==next){query=next;source=nextSource}}}
  function render(){
    const toolbar=h.render('toolbar',Toolbar,props)
    const search=nodes(toolbar).find(node=>node.type===SearchBox)
    tree=h.render('search',SearchBox,search.props)
    h.render('catalog',()=>useProductCatalog(page,20,filters,query,'u',source))
  }
  async function advance(ms){
    const end=now+ms
    while(true){
      const due=[...timers].filter(([,timer])=>timer.at<=end).sort((a,b)=>a[1].at-b[1].at)[0]
      if(!due)break
      timers.delete(due[0]);now=due[1].at;due[1].callback()
      await Promise.resolve();await Promise.resolve();await Promise.resolve()
    }
    now=end;render()
  }
  const input=()=>nodes(tree).find(node=>node.type==='input').props
  render()
  return {api,calls,render,advance,h,
    type(value){input().onChange({target:{value},nativeEvent:{}});render()},
    key(key){input().onKeyDown({key,currentTarget:{value:input().value},preventDefault(){}});render()},
    clear(){nodes(tree).find(node=>node.props?.['aria-label']==='Borrar búsqueda').props.onClick();render()},
    recent(value){input().onClick();render();nodes(tree).find(node=>node.type==='button'&&label(node)===value).props.onClick();render()},
    filter(){filters={brands:['demo']};render()},paginate(){page++;render()},selected:()=>selected,
  }
}

test('Search real: debounce, autocomplete, Enter repetido, filtros y pagination',async t=>{
  const f=await searchFlow(t)
  await f.advance(250)
  assert.equal(f.api.getAnalyticsCounters('u').searches,0,'carga inicial')
  f.type('ssd')
  await f.advance(200)
  assert.equal(f.calls.autocomplete.length,1)
  assert.equal(f.api.getAnalyticsCounters('u').searches,0,'autocomplete no es búsqueda del catálogo')
  await f.advance(50)
  assert.equal(f.calls.catalog.filter(call=>call.query==='ssd').length,1)
  assert.equal(f.api.getAnalyticsCounters('u').searches,1)
  f.key('Enter');f.key('Enter');f.render();f.filter();f.paginate()
  assert.equal(f.api.getAnalyticsCounters('u').searches,1)
  const requests=f.calls.catalog.length
  f.h.runtime.replay('catalog')
  assert.equal(f.calls.catalog.length,requests+1,'el replay realmente vuelve a ejecutar el Effect')
  assert.equal(f.api.getAnalyticsCounters('u').searches,1)
  await f.api.flushAnalytics()
  assert.equal(JSON.stringify(f.api.getAnalyticsEvents('u')).includes('ssd'),false)
})

test('Search continúa y registra en memoria con storage bloqueado',async t=>{
  const f=await searchFlow(t)
  window.localStorage.getItem=()=>{throw new Error('blocked')}
  window.localStorage.setItem=()=>{throw new Error('quota')}
  f.type('ssd');await f.advance(250)
  assert.equal(f.calls.catalog.at(-1).query,'ssd')
  assert.equal(f.api.getAnalyticsCounters('u').searches,1)
  await f.api.flushAnalytics()
})

test('Search real: sugerencia antes/después del debounce y Recent Search solo si ejecuta query',async t=>{
  const f=await searchFlow(t)
  f.type('ssd');await f.advance(200)
  f.key('ArrowDown');f.key('Enter')
  assert.equal(f.selected(),1)
  assert.equal(f.api.getAnalyticsCounters('u').searches,0)
  await f.advance(50)
  assert.equal(f.api.getAnalyticsCounters('u').searches,1)
  f.key('Enter')
  assert.equal(f.api.getAnalyticsCounters('u').searches,1)
  f.clear();await f.advance(250)
  f.recent('ssd');await f.advance(250)
  assert.equal(f.api.getAnalyticsCounters('u').searches,2)
  assert.deepEqual(f.api.getAnalyticsEvents('u').map(event=>event.metadata.source),['catalog','recent'])
  await f.api.flushAnalytics()
})
