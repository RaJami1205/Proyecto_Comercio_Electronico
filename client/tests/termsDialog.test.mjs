/** CN-46: contenido y callbacks reales; el DOM, top layer y foco real requieren navegador. */
import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import ts from 'typescript'
const dataUrl=source=>'data:text/javascript;base64,'+Buffer.from(source).toString('base64')
const runtimeUrl=dataUrl(`
  let refs=[], effects=[], ids=0;
  export function reset(){refs=[];effects=[];ids=0;}
  export function useRef(value){const ref={current:value};refs.push(ref);return ref;}
  export function useEffect(effect){effects.push(effect);}
  export function useId(){return 'terms-test-'+ids++;}
  export function getRefs(){return refs;}
  export function mount(){return effects.map(effect=>effect());}
  export const Fragment='Fragment';
  export function jsx(type,props){return {type,props};}
  export const jsxs=jsx;
`)
const runtime=await import(runtimeUrl), modules=new Map()
function compile(file){
  if(modules.has(file))return modules.get(file)
  const source=readFileSync(new URL('../src/'+file,import.meta.url),'utf8')
  const js=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2023,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}}).outputText
  const url=dataUrl(js.replace(/from ['"]([^'"]+)['"]/g,(_,dep)=>{
    if(dep==='react'||dep==='react/jsx-runtime')return 'from '+JSON.stringify(runtimeUrl)
    if(dep.endsWith('.css'))return 'from '+JSON.stringify(dataUrl('export default {}'))
    assert.ok(dep.startsWith('.'))
    const path=new URL(dep,'https://source/'+file).pathname.slice(1)
    return 'from '+JSON.stringify(compile(path+(path.startsWith('content/')?'.ts':'.tsx')))
  }))
  modules.set(file,url);return url
}
const {default:TermsDialog}=await import(compile('components/checkout/TermsDialog.tsx'))
const {termsPolicy}=await import(compile('content/terms.ts'))
function expand(tree){
  if(Array.isArray(tree))return tree.map(expand)
  if(!tree||typeof tree!=='object')return tree
  if(typeof tree.type==='function')return expand(tree.type(tree.props))
  return {...tree,props:{...tree.props,children:expand(tree.props.children)}}
}
function nodes(tree){return Array.isArray(tree)?tree.flatMap(nodes):tree&&typeof tree==='object'?[tree,...nodes(tree.props.children)]:[]}
function text(tree){return Array.isArray(tree)?tree.map(text).join(' '):tree&&typeof tree==='object'?text(tree.props.children):typeof tree==='string'?tree:''}

test('TermsDialog reutiliza título, introducción, versión y todo el contenido sin controles de aceptación',()=>{
  runtime.reset()
  let closed=0
  const tree=expand(TermsDialog({onClose:()=>closed++})), all=nodes(tree)
  assert.equal(tree.type,'dialog')
  assert.equal(all.find(n=>n.props.id===tree.props['aria-labelledby']).type,'h1')
  for(const value of [termsPolicy.title,termsPolicy.introduction,termsPolicy.version])assert.ok(text(tree).includes(value))
  for(const section of termsPolicy.sections){
    for(const value of [section.title,...section.paragraphs,...section.items??[]])assert.ok(text(tree).includes(value))
  }
  assert.equal(all.filter(n=>['header','footer','main','input','a'].includes(n.type)).length,0)
  all.find(n=>n.type==='button').props.onClick()
  let prevented=false
  tree.props.onCancel({preventDefault(){prevented=true}})
  assert.equal(prevented,true)
  assert.equal(closed,2)
})

test('TermsDialog no presenta como vigente una versión rechazada',()=>{
  runtime.reset()
  const tree=expand(TermsDialog({onClose:()=>{},versionRejected:true}))
  assert.match(text(tree),/Versión local rechazada por el servidor/)
  assert.doesNotMatch(text(tree),/Versión vigente/)
  assert.ok(text(tree).includes(termsPolicy.version))
})

test('TermsDialog solicita modalidad, foco y restaura estilos; simulación de lifecycle, no navegador',t=>{
  runtime.reset()
  let opened=0,closed=0,focused=0,restored=0
  class Element {
    isConnected=true
    closest(){return null}
    getClientRects(){return [1]}
    focus(){restored++}
  }
  const original=new Map()
  function install(key,value){original.set(key,Object.getOwnPropertyDescriptor(globalThis,key));Object.defineProperty(globalThis,key,{value,configurable:true,writable:true})}
  t.after(()=>{for(const [key,descriptor] of original){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key]}})
  const trigger=new Element(), style={overflow:'auto',paddingRight:'4px'}, frames=[]
  install('HTMLElement',Element)
  install('document',{activeElement:trigger,body:{style},documentElement:{clientWidth:980}})
  install('window',{innerWidth:1000})
  install('getComputedStyle',()=>({paddingRight:'4px'}))
  install('requestAnimationFrame',callback=>{frames.push(callback);return frames.length})
  install('cancelAnimationFrame',()=>{})
  TermsDialog({onClose:()=>{}})
  const [dialog,close]=runtime.getRefs()
  dialog.current={open:false,showModal(){this.open=true;opened++},close(){this.open=false;closed++}}
  close.current={focus(){focused++}}
  const [cleanup]=runtime.mount()
  assert.equal(opened,1);assert.equal(focused,1)
  assert.deepEqual(style,{overflow:'hidden',paddingRight:'24px'})
  cleanup()
  assert.equal(closed,1)
  assert.deepEqual(style,{overflow:'auto',paddingRight:'4px'})
  frames.forEach(callback=>callback())
  assert.equal(restored,1)
})
