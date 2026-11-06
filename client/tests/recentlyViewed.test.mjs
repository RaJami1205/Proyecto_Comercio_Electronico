/** Verifica que la sección muestre datos actuales y abra el detalle desde el producto seleccionado. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

const dataUrl = source => 'data:text/javascript;base64,' + Buffer.from(source).toString('base64')
const runtimeUrl = dataUrl(`
  let slots=[],cursor=0;
  export function begin(){cursor=0;}
  export function useState(initial){const index=cursor++;if(!(index in slots))slots[index]=typeof initial==='function'?initial():initial;return [slots[index],value=>{slots[index]=typeof value==='function'?value(slots[index]):value;}];}
  export function useEffect(effect){effect();}
  export function jsx(type,props){return {type,props};} export const jsxs=jsx;
`)
const product = { id: 'p1', name: 'Laptop vigente', image: '/laptop.png', price: 125000, category: 'Laptop', inStock: true, description: '', specifications: [] }
const apiUrl = dataUrl('export async function getProductsByIds(ids){return ids.includes("p1")?[globalThis.currentProduct]:[]}')
const analyticsUrl = dataUrl('export const analyticsStorage={changedEvent:"analytics-change",keyPrefix:"cibernova:analytics:v1:"}; export function getRecentlyViewedProductIds(){return ["p1"];} export function refreshAnalyticsState(){}')
const source = readFileSync(new URL('../src/components/catalog/RecentlyViewedProducts.tsx', import.meta.url), 'utf8')
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX } }).outputText
const js = compiled.replace(/from ['"]([^'"]+)['"]/g, (_match, dependency) => 'from ' + JSON.stringify(
  dependency === 'react' || dependency === 'react/jsx-runtime' ? runtimeUrl : dependency.includes('productApi') ? apiUrl
    : dependency.includes('analytics') ? analyticsUrl : dataUrl('export default {}'),
))
const { default: RecentlyViewedProducts } = await import(dataUrl(js))
globalThis.window = { addEventListener() {}, removeEventListener() {} }

test('resuelve la vista desde los IDs y permite abrir el Quick View del producto', async () => {
  globalThis.currentProduct = product
  const opened = []
  const props = { userId: 'user-a', onProductSelect: value => opened.push(value) }
  const runtime = await import(runtimeUrl)
  runtime.begin()
  let tree = RecentlyViewedProducts(props)
  await new Promise(resolve => setImmediate(resolve))
  runtime.begin()
  tree = RecentlyViewedProducts(props)
  assert.equal(tree.type, 'section')
  const buttons = tree.props.children[1].props.children
  buttons[0].props.onClick()
  assert.deepEqual(opened, [product])
})
