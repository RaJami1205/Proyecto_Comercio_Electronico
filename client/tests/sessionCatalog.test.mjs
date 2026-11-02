/** Verifica el catálogo real y el estado de Recent Searches al cambiar la key de sesión del Toolbar. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

const dataUrl = source => 'data:text/javascript;base64,' + Buffer.from(source).toString('base64')
const runtimeUrl = dataUrl(`
  let scopes=new Map(), slots=[],cursor=0; export let dirty=false,epoch=0,queries=[];
  export function reset() {scopes=new Map();epoch=0;queries=[];}
  export function nextSession() {epoch++;}
  export function begin(scope) {if(!scopes.has(scope))scopes.set(scope,[]);slots=scopes.get(scope);cursor=0;dirty=false;}
  export function useState(initial) {const index=cursor++,owner=slots;if(!(index in owner))owner[index]=typeof initial==='function'?initial():initial;return [owner[index],value=>{const next=typeof value==='function'?value(owner[index]):value;if(!Object.is(owner[index],next))dirty=true;owner[index]=next;}];}
  export function useRef(initial) {const [ref]=useState(()=>({current:initial}));return ref;}
  export function useCallback(callback) {return callback;}
  export function useEffect() {}
  export function useSession() {return {epoch};}
  export function useCatalogPagination() {const [currentPage,setCurrentPage]=useState(1);return {currentPage,pageSize:20,setCurrentPage};}
  export function useProductCatalog(_page,_size,_filters,query) {queries.push(query);return {products:[],totalPages:1,nbHits:0,facets:{},isLoading:false,error:null};}
  export function jsx(type,props,key) {return {type,props,key};}export const jsxs=jsx; export const Fragment='Fragment';
`)
const runtime = await import(runtimeUrl)
const modules = new Map([['react', runtimeUrl], ['react/jsx-runtime', runtimeUrl], ['../hooks/useSession', runtimeUrl],
  ['../hooks/useCatalogPagination', runtimeUrl], ['../hooks/useProductCatalog', runtimeUrl],
  ['../utils/scrollToAnchor', dataUrl('export function scrollToElement() {}')]])
for (const name of ['CartFeedbackToast', 'CatalogFilters', 'CatalogHero', 'CatalogToolbar', 'Pagination', 'ProductGrid', 'ProductQuickView']) {
  modules.set('../components/catalog/' + name, dataUrl(`export default '${name}'`))
}
for (const name of ['Header', 'Footer']) modules.set('../components/layout/' + name, dataUrl(`export default '${name}'`))
function compile(file) {
  const source = readFileSync(new URL('../src/' + file, import.meta.url), 'utf8')
  const js = ts.transpileModule(source, {compilerOptions:{target:ts.ScriptTarget.ES2023,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}}).outputText
  return dataUrl(js.replace(/from ['"]([^'"]+)['"]/g, (_match, dependency) => {
    const target = dependency.endsWith('.css') ? dataUrl('export default {}') : modules.get(dependency)
    assert.ok(target, 'Dependencia inesperada: ' + dependency)
    return 'from ' + JSON.stringify(target)
  }))
}
const {default: ProductListingPage} = await import(compile('pages/ProductListingPage.tsx'))
const {default: SearchBox} = await import(compile('components/catalog/SearchBox.tsx'))
const nodes = tree => Array.isArray(tree) ? tree.flatMap(nodes) : tree && typeof tree === 'object' ? [tree,...nodes(tree.props?.children)] : []
const text = tree => Array.isArray(tree) ? tree.map(text).join(' ') : tree && typeof tree === 'object' ? text(tree.props?.children) : typeof tree === 'string' ? tree : ''

test('cambiar Session limpia query/Quick View y cambia solo la key del Toolbar, conservando el catálogo', () => {
  runtime.reset()
  const props = {active:true,isCartPreviewOpen:false,onCartClick(){},onProductAdded(){},onPolicyNavigate(){},feedback:null}
  function render() {
    let tree
    for (let render = 0; render < 5; render++) {
      runtime.begin('catalog')
      tree = ProductListingPage(props)
      if (!runtime.dirty) return tree
    }
    assert.fail('El ajuste de sesión no debe producir renders infinitos')
  }
  let tree = render()
  let toolbar = nodes(tree).find(node => node.type === 'CatalogToolbar')
  toolbar.props.onSearchChange('laptop')
  toolbar.props.onProductSelect({id:'p',name:'Producto'})
  tree = render()
  assert.equal(runtime.queries.at(-1), 'laptop')
  assert.ok(nodes(tree).find(node => node.type === 'ProductQuickView'))
  const previousKey = toolbar.key
  runtime.nextSession()
  tree = render()
  toolbar = nodes(tree).find(node => node.type === 'CatalogToolbar')
  assert.notEqual(toolbar.key, previousKey)
  assert.equal(runtime.queries.at(-1), '')
  assert.equal(nodes(tree).some(node => node.type === 'ProductQuickView'), false)
  assert.equal(tree.props.hidden, false)
  assert.equal(tree.props.inert, false)
})

test('Recent Searches vive en el componente y no se hereda al nuevo scope de sesión', () => {
  runtime.reset()
  const props = {query:'laptop',results:[],isLoading:false,error:null,onQueryChange(){},onSelectResult(){}}
  const render = scope => {runtime.begin(scope);return SearchBox(props)}
  let tree = render('toolbar:0/search')
  nodes(tree).find(node => node.type === 'input').props.onKeyDown({key:'Enter',currentTarget:{value:'laptop'},preventDefault(){}})
  props.query = ''
  tree = render('toolbar:0/search')
  nodes(tree).find(node => node.type === 'input').props.onClick()
  tree = render('toolbar:0/search')
  assert.match(text(tree), /laptop/)
  tree = render('toolbar:1/search')
  nodes(tree).find(node => node.type === 'input').props.onClick()
  tree = render('toolbar:1/search')
  assert.doesNotMatch(text(tree), /laptop|Recientes/)
})
