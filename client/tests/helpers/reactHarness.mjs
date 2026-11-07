import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import ts from 'typescript'
import { dataUrl } from './analyticsHarness.mjs'

let instance = 0
/** Harness de handlers y fases render/commit; no pretende sustituir React DOM. */
export async function reactHarness() {
  const url = dataUrl(`
    const scopes=new Map(); let current,cursor=0,nextId=0;
    export let cartContext={}, sessionUser={id:'u',role:'B2C'}, epoch=0;
    export function setCart(value){cartContext=value;}
    export function setUser(value){sessionUser=value;epoch++;}
    export function begin(name){if(!scopes.has(name))scopes.set(name,{slots:[],effects:new Map(),dirty:false});current=scopes.get(name);cursor=0;current.effects.clear();current.dirty=false;}
    export function dirty(){return current.dirty;}
    export function useState(initial){const at=cursor++,scope=current;if(!(at in scope.slots))scope.slots[at]=typeof initial==='function'?initial():initial;return [scope.slots[at],value=>{const next=typeof value==='function'?value(scope.slots[at]):value;if(!Object.is(next,scope.slots[at]))scope.dirty=true;scope.slots[at]=next;}];}
    export function useRef(initial){const [value]=useState(()=>({current:initial}));return value;}
    export function useId(){const [value]=useState(()=>'test-id-'+nextId++);return value;}
    export function useCallback(callback,deps){const at=cursor++,old=current.slots[at];if(!old||deps.some((v,i)=>!Object.is(v,old.deps[i])))current.slots[at]={callback,deps};return current.slots[at].callback;}
    export function useEffect(effect,deps){const at=cursor++,old=current.slots[at];if(!old||deps.some((v,i)=>!Object.is(v,old.deps[i])))current.effects.set(at,{effect,deps});}
    export function commit(name){const scope=scopes.get(name),replay=[];for(const [at,{effect,deps}] of scope.effects){scope.slots[at]?.cleanup?.();scope.slots[at]={deps,cleanup:effect()};replay.push(effect);}scope.effects.clear();scope.lastEffects=replay;return replay;}
    export function replay(name){scopes.get(name).lastEffects.forEach(effect=>effect());}
    export function unmount(name){const scope=scopes.get(name);if(scope)for(const slot of scope.slots)slot?.cleanup?.();scopes.delete(name);}
    export function dispose(){for(const scope of scopes.values())for(const slot of scope.slots)slot?.cleanup?.();scopes.clear();}
    export function useReducer(reducer,initial,initialize){const [state,set]=useState(()=>initialize?initialize(initial):initial);return [state,action=>set(value=>reducer(value,action))];}
    export function useCart(){return cartContext;}
    const reason=()=>!sessionUser?'Sin sesión':sessionUser.role!=='B2C'?'Solo B2C':null;
    const noop=()=>{};
    export function useSession(){return {user:sessionUser,epoch,dialog:null,purchaseBlockReason:reason(),getPurchaseBlockReason:reason,isTransactionBlocked:()=>false,setCheckoutMounted:noop,setTransactionState:noop};}
    export function useCatalogPagination(){const [currentPage,setCurrentPage]=useState(1);return {currentPage,pageSize:20,setCurrentPage};}
    export function jsx(type,props,key){return {type,props,key};}export const jsxs=jsx,Fragment='Fragment';
  `) + '#react-' + instance++
  const runtime = await import(url)
  const overrides = new Map([['react', url], ['react/jsx-runtime', url], ['hooks/useCart', url],
    ['hooks/useSession', url], ['hooks/useCatalogPagination', url]])
  const cache = new Map()
  function compile(file) {
    if (overrides.has(file)) return overrides.get(file)
    if (cache.has(file)) return cache.get(file)
    const root = new URL('../../src/', import.meta.url)
    const extension = existsSync(new URL(file + '.tsx', root)) ? '.tsx' : '.ts'
    const source = readFileSync(new URL(file + extension, root), 'utf8').replaceAll('import.meta.env.VITE_API_BASE_URL', 'undefined')
    const js = ts.transpileModule(source, {compilerOptions:{target:ts.ScriptTarget.ES2023,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}}).outputText
    const compiled = dataUrl(js.replace(/from ['"]([^'"]+)['"]/g, (_, dependency) => {
      const target = dependency.startsWith('.') ? path.posix.normalize(path.posix.join(path.posix.dirname(file), dependency)).replace(/\.tsx?$/, '') : dependency
      return 'from ' + JSON.stringify(dependency.endsWith('.css') ? dataUrl('export default {}') : overrides.get(target) ?? compile(target))
    }))
    cache.set(file, compiled)
    return compiled
  }
  const load = async file => import(compile(file))
  function render(name, component, props = {}, commit = true) {
    let tree
    for (let attempt=0;attempt<8;attempt++) {
      runtime.begin(name);tree=component(props)
      if (!runtime.dirty()) { if(commit)runtime.commit(name);return tree }
    }
    throw new Error('Render no converge: ' + name)
  }
  return { runtime, url, overrides, load, render }
}

export const nodes = tree => Array.isArray(tree) ? tree.flatMap(nodes) : tree && typeof tree === 'object' ? [tree,...nodes(tree.props?.children)] : []
export const label = tree => Array.isArray(tree) ? tree.map(label).join(' ') : tree && typeof tree === 'object' ? label(tree.props?.children) : typeof tree === 'string' ? tree : ''
