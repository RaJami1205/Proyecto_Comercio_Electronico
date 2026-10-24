/** Verifica Review, diferencias financieras, retry y replay mediante handlers de Checkout y respuestas HTTP simuladas. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

/** Codifica el código recibido como módulo importable en memoria. */
const dataUrl = source => 'data:text/javascript;base64,' + Buffer.from(source).toString('base64')
// Harness de handlers/estado; no sustituye las verificaciones DOM, foco o responsive.
const runtimeUrl = dataUrl(`
  let slots = [], cursor = 0;
  export let cart = []; export let cleanupCount = 0;
  export function reset(items) { slots = []; cursor = 0; cart = items; cleanupCount = 0; }
  export function renderStart() { cursor = 0; }
  export function useState(initial) {
    const index = cursor++;
    if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial;
    return [slots[index], value => { slots[index] = typeof value === 'function' ? value(slots[index]) : value; }];
  }
  export function useRef(initial) { const [value] = useState(() => ({current:initial})); return value; }
  export function useEffect() {}
  export function useCart() { return {items:cart, cleanupPurchase: () => { cleanupCount++; throw new Error('No se permite cleanup automático'); }}; }
  export const Fragment = 'Fragment';
  export function jsx(type, props) { return {type, props}; }
  export const jsxs = jsx;
`)
const runtime = await import(runtimeUrl)
const modules = new Map([
  ['react', runtimeUrl], ['react/jsx-runtime', runtimeUrl],
  ['../hooks/useCart', runtimeUrl],
])
for (const name of ['CheckoutStepper', 'BuyerStep', 'DeliveryStep', 'ReviewStep', 'PaymentStep', 'PaymentResultPanel', 'TermsDialog']) {
  modules.set('../components/checkout/' + name, dataUrl(`export default ${JSON.stringify(name)}`))
}
for (const name of ['Header', 'Footer']) modules.set('../components/layout/' + name, dataUrl(`export default ${JSON.stringify(name)}`))
/** Transpila el archivo indicado y resuelve únicamente las dependencias aisladas del harness. */
function compile(file) {
  const source = readFileSync(new URL('../src/' + file, import.meta.url), 'utf8').replace('import.meta.env.VITE_API_BASE_URL', 'undefined')
  const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX } }).outputText
  return dataUrl(js.replace(/from ['"]([^'"]+)['"]/g, (_, dependency) => {
    const target = dependency.endsWith('.css') ? dataUrl('export default {}') : modules.get(dependency)
    assert.ok(target, 'Dependencia sin aislar: ' + dependency)
    return 'from ' + JSON.stringify(target)
  }))
}
const termsUrl = compile('content/terms.ts')
modules.set('../content/terms', termsUrl)
modules.set('../../content/terms', termsUrl)
const { termsPolicy } = await import(termsUrl)
const calculationsUrl = compile('utils/cartCalculations.ts')
modules.set('./cartCalculations', calculationsUrl)
modules.set('../utils/cartCalculations', calculationsUrl)
modules.set('../utils/checkoutValidation', compile('utils/checkoutValidation.ts'))
const differencesUrl = compile('utils/orderReviewDifferences.ts')
modules.set('../utils/orderReviewDifferences', differencesUrl)
const apiUrl = compile('services/orderApi.ts')
modules.set('../services/orderApi', apiUrl)
modules.set('../services/paymentApi', compile('services/paymentApi.ts'))
modules.set('./OrderConfirmationPage', dataUrl("export default 'OrderConfirmationPage'"))
const { default: CheckoutPage } = await import(compile('pages/CheckoutPage.tsx'))
const { default: ReviewStep } = await import(compile('components/checkout/ReviewStep.tsx'))
const { orderReviewDifferences } = await import(differencesUrl)
const { calculateCartTotals } = await import(calculationsUrl)
const buyer = { fullName: 'Prueba', email: 'test@example.com', phone: '88888888' }
const delivery = { province: 'San José', canton: 'Central', address: 'Dirección' }
const cart = [{ productId: 'p', name: 'Producto', image: '', price: 10000, quantity: 1 }]
/** Devuelve un snapshot pendiente de prueba con comprador, entrega e importes conocidos. */
function order() {
  return { id:'order-1', orderNumber:'CN-1', createdAt:'2026-10-12T00:00:00Z', buyer, delivery,
    items:[{productId:'p', name:'Producto', image:'', unitPrice:10000, quantity:1, lineSubtotal:10000}],
    totals:calculateCartTotals(cart), currency:'CRC', orderStatus:'PENDING', paymentStatus:'PENDING' }
}
/** Recorre el árbol JSX simulado y devuelve sus nodos para inspeccionar propiedades. */
function nodes(tree) {
  if (Array.isArray(tree)) return tree.flatMap(nodes)
  if (!tree || typeof tree !== 'object') return []
  return [tree, ...nodes(tree.props?.children)]
}
/** Extrae el texto del árbol JSX simulado para comprobar los mensajes presentados. */
function text(tree) {
  if (Array.isArray(tree)) return tree.map(text).join(' ')
  if (tree && typeof tree === 'object') return text(tree.props?.children)
  return typeof tree === 'string' ? tree : ''
}
/** Inicializa el Cart y recorre Buyer y Delivery; devuelve controles del harness para probar Review y Payment. */
function checkout({ acceptTerms = true } = {}) {
  runtime.reset(structuredClone(cart))
  const events = []
  const props = { onBackToCart: () => events.push('exit'), onCatalogClick: () => events.push('catalog'), onCartClick: () => {},
    onNavigationLockChange: busy => events.push(busy), onOrderCreated: () => events.push('created') }
  let tree
  /** Actualiza el árbol simulado de Checkout conservando sus slots de estado. */
  const render = () => { runtime.renderStart(); tree = CheckoutPage(props) }
  /** Devuelve las propiedades del primer componente del tipo solicitado en el árbol simulado. */
  const find = type => nodes(tree).find(node => node.type === type)?.props
  render()
  find('BuyerStep').onContinue(buyer)
  render()
  find('DeliveryStep').onContinue(delivery)
  render()
  if (acceptTerms) { find('ReviewStep').onTermsAcceptedChange(true); render() }
  return { render, find, review: () => find('ReviewStep'), payment: () => find('PaymentStep'), step: () => find('CheckoutStepper').currentStep, events }
}
/** Ejecuta el caso con un responder simulado, captura sus solicitudes y restaura fetch al terminar. */
async function withFetch(responder, run) {
  const original = globalThis.fetch
  const requests = []
  globalThis.fetch = async (_, options) => {
    requests.push(JSON.parse(options.body))
    return responder(requests.length)
  }
  try { await run(requests) } finally { globalThis.fetch = original }
}

test('F4 igualdad exacta permite avance normal', async () => {
  assert.deepEqual(orderReviewDifferences(cart, order()), [])
  await withFetch(() => Response.json(order(), {status:201}), async requests => {
    const flow = checkout()
    await flow.review().onConfirm()
    flow.render()
    assert.equal(flow.step(), 'payment')
    assert.equal(requests.length, 1)
  })
})
for (const field of ['subtotal', 'tax', 'shipping', 'total']) {
  test('F4 detecta ' + field + ' sin redondeo visual', () => {
    const changed = order()
    changed.totals[field] += 0.001
    assert.equal(orderReviewDifferences(cart, changed).length, 1)
  })
}
test('F4 identifica precios, cantidades, líneas y productos añadidos/retirados', () => {
  for (const field of ['unitPrice', 'lineSubtotal', 'quantity']) {
    const changed = order()
    changed.items[0][field] += field === 'quantity' ? 1 : 0.001
    assert.equal(orderReviewDifferences(cart, changed).length, 1)
  }
  const changed = order()
  changed.items[0].productId = 'another'
  assert.equal(orderReviewDifferences(cart, changed).length, 2)
})
for (const field of ['total', 'tax', 'shipping', 'unitPrice']) {
  test('F4 ' + field + ' requiere aceptación y reutiliza la misma Order', async () => {
    const changed = order()
    if (field === 'unitPrice') changed.items[0].unitPrice += 0.001
    else changed.totals[field] += 0.001
    await withFetch(() => Response.json(changed, {status:201}), async requests => {
      const flow = checkout()
      await flow.review().onConfirm()
      flow.render()
      assert.equal(flow.step(), 'review')
      assert.ok(flow.review().differences.length)
      assert.equal(flow.review().onEdit, undefined)
      assert.deepEqual(flow.review().totals, changed.totals)
      assert.match(text(ReviewStep(flow.review())), /Aceptar cambios y continuar al pago/)
      assert.equal(flow.events.at(-1), true)
      const authoritative = flow.review().order
      await flow.review().onConfirm()
      flow.render()
      assert.equal(flow.step(), 'payment')
      assert.equal(flow.payment().order, authoritative)
      assert.equal(requests.length, 1)
      assert.equal(flow.events.at(-1), false)
    })
  })
}
test('F4 compara Shipping redondeado y detecta un envío autoritativo diferente', () => {
  const below = [{ ...cart[0], price:99999.995 }]
  const changed = order()
  changed.items[0] = { ...changed.items[0], unitPrice:99999.995, lineSubtotal:99999.995 }
  changed.totals = calculateCartTotals(below)
  assert.equal(changed.totals.shipping, 0)
  assert.deepEqual(orderReviewDifferences(below, changed), [])
  changed.totals.shipping = 3500
  assert.match(orderReviewDifferences(below, changed)[0], /Envío/)
})

test('F4 IVA alineado con Server no produce diferencias artificiales ni exige aceptación', async () => {
  const fractional = [{...cart[0], price:99999.995}]
  // Snapshot explícito: no calcula los importes esperados mediante la utilidad Client.
  const authoritative = {
    ...order(),
    items:[{...order().items[0], unitPrice:99999.995, lineSubtotal:99999.995}],
    totals:{subtotal:99999.995, tax:13000, shipping:0, total:112999.995},
  }
  assert.deepEqual(orderReviewDifferences(fractional, authoritative), [])
  await withFetch(() => Response.json(authoritative, {status:201}), async requests => {
    const flow = checkout()
    runtime.cart[0].price = 99999.995
    flow.render()
    await flow.review().onConfirm()
    flow.render()
    assert.equal(flow.step(), 'payment')
    assert.deepEqual(orderReviewDifferences(fractional, flow.payment().order), [])
    assert.deepEqual(flow.payment().order.totals, authoritative.totals)
    assert.equal(requests.length, 1)
  })
})
test('F4 salida advierte que la orden existe y conserva Cart', async () => {
  const changed = order()
  changed.totals.total++
  await withFetch(() => Response.json(changed, {status:201}), async requests => {
    const flow = checkout()
    await flow.review().onConfirm()
    flow.render()
    assert.ok(flow.review().order)
    assert.match(text(ReviewStep(flow.review())), /La orden no se cancela/)
    assert.match(text(ReviewStep(flow.review())), /conservas los productos del carrito/)
    flow.review().onAbandon()
    assert.deepEqual(flow.events.slice(-2), [false, 'exit'])
    assert.equal(requests.length, 1)
    assert.deepEqual(runtime.cart, cart)
  })
})
test('F5 errores persistentes preservan key/payload/datos y ofrecen salida explícita', async () => {
  await withFetch(() => { throw new TypeError('simulated network failure') }, async requests => {
    const flow = checkout()
    await flow.review().onConfirm()
    flow.render()
    const first = structuredClone(requests[0])
    assert.equal(flow.step(), 'review')
    assert.equal(flow.review().retryPending, true)
    assert.deepEqual(flow.review().buyer, buyer)
    assert.deepEqual(flow.review().delivery, delivery)
    flow.review().onEdit('buyer')
    flow.render()
    assert.equal(flow.step(), 'review')
    await flow.review().onConfirm()
    flow.render()
    assert.deepEqual(requests[1], first)
    const message = text(ReviewStep(flow.review()))
    assert.match(message, /La orden podría haberse creado/)
    assert.match(message, /podría crear una orden duplicada/)
    assert.match(message, /conservas los productos del carrito/)
    flow.review().onAbandon()
    assert.deepEqual(flow.events.slice(-2), [false, 'exit'])
    assert.equal(requests.length, 2)
    assert.deepEqual(runtime.cart, cart)
  })
})
test('F5 retry resuelto conserva identidad y compara el intento original, no Cart actualizado', async () => {
  await withFetch(count => {
    if (count === 1) throw new TypeError('simulated timeout')
    return Response.json(order(), {status:201})
  }, async requests => {
    const flow = checkout()
    await flow.review().onConfirm()
    flow.render()
    runtime.cart[0].price = 50000
    await flow.review().onConfirm()
    flow.render()
    assert.deepEqual(requests[1], requests[0])
    assert.equal(flow.step(), 'payment')
    assert.equal(flow.payment().order.totals.total, order().totals.total)
  })
})
for (const paymentStatus of ['PENDING', 'DECLINED', 'ERROR']) {
  test('Replay pendiente ' + paymentStatus + ' conserva Order y Cart', async () => {
    await withFetch(() => Response.json({...order(), paymentStatus}, {status:201}), async requests => {
      const flow = checkout()
      await flow.review().onConfirm()
      flow.render()
      assert.equal(flow.step(), 'payment')
      assert.equal(flow.payment().order.paymentStatus, paymentStatus)
      assert.equal(flow.find('OrderConfirmationPage'), undefined)
      assert.equal(requests.length, 1)
      assert.deepEqual(runtime.cart, cart)
      if (paymentStatus !== 'PENDING') {
        flow.find('button').onClick() // Revisar orden desde Payment.
        flow.render()
        assert.equal(flow.step(), 'review')
        assert.match(text(ReviewStep(flow.review())), /último intento de pago/)
      }
    })
  })
}
for (const changed of [false, true]) {
  test('Replay confirmado tras retry, diferencias=' + changed + ': sin Pago ni cleanup', async () => {
    const confirmed = {...order(), orderStatus:'CONFIRMED', paymentStatus:'APPROVED'}
    if (changed) confirmed.totals.total += 500
    await withFetch(count => {
      if (count === 1) throw new TypeError('simulated timeout')
      return Response.json(confirmed, {status:201})
    }, async requests => {
      const flow = checkout()
      await flow.review().onConfirm()
      flow.render()
      assert.equal(flow.review().retryPending, true)
      await flow.review().onConfirm()
      flow.render()
      assert.deepEqual(requests[1], requests[0])
      // CN-33 reemplaza Review por Confirmation: no hay edición, aceptación ni Retry.
      const confirmation = flow.find('OrderConfirmationPage')
      assert.ok(confirmation)
      assert.deepEqual(confirmation.order, confirmed)
      assert.equal(flow.review(), undefined)
      assert.equal(flow.payment(), undefined)
      assert.equal(flow.find('CheckoutStepper'), undefined)
      assert.equal(flow.find('PaymentResultPanel'), undefined)
      assert.equal(confirmation.onConfirm, undefined)
      assert.equal(confirmation.onEdit, undefined)
      assert.equal(flow.events.at(-1), false)
      assert.equal(runtime.cleanupCount, 0)
      assert.deepEqual(runtime.cart, cart)
      confirmation.onCatalogClick()
      assert.equal(flow.events.at(-1), 'catalog')
      assert.equal(requests.length, 2)
      assert.deepEqual(runtime.cart, cart)
    })
  })
}

// CN-46: el helper acepta explícitamente solo para preparar las regresiones anteriores.
test('CN-46 sin aceptación: cero POST/UUID, Review y error asociado al checkbox', async t => {
  let uuids = 0, focused = 0
  t.mock.method(globalThis.crypto, 'randomUUID', () => { uuids++; return 'new-key' })
  await withFetch(() => Response.json(order(), {status:201}), async requests => {
    const flow = checkout({acceptTerms:false})
    assert.equal(flow.review().termsAccepted, false)
    flow.review().termsInputRef.current = {focus:()=>focused++}
    await flow.review().onConfirm(); flow.render()
    assert.equal(requests.length, 0)
    assert.equal(uuids, 0)
    assert.equal(focused, 1)
    assert.equal(flow.step(), 'review')
    assert.equal(flow.review().retryPending, false)
    assert.deepEqual(flow.review().buyer, buyer)
    assert.deepEqual(flow.review().delivery, delivery)
    const rendered = nodes(ReviewStep(flow.review()))
    const checkbox = rendered.find(n=>n.type==='input')
    assert.equal(checkbox.props.checked, false)
    assert.equal(checkbox.props['aria-invalid'], true)
    assert.ok(checkbox.props['aria-describedby'].includes('checkout-terms-error'))
    assert.equal(rendered.find(n=>n.props.id==='checkout-terms-error').props.role, 'alert')
    assert.equal(rendered.find(n=>n.type==='label').props.htmlFor, checkbox.props.id)
    flow.review().onTermsAcceptedChange(true); flow.render()
    assert.equal(flow.review().termsError, undefined)
    await flow.review().onConfirm(); flow.render()
    assert.equal(uuids, 1)
    assert.equal(requests.length, 1)
    assert.deepEqual(requests[0].termsAcceptance, {accepted:true, version:termsPolicy.version})
    assert.equal('acceptedAt' in requests[0].termsAcceptance, false)
    assert.equal(flow.step(), 'payment')
  })
})

test('CN-46 retirar consentimiento y nuevo Checkout requieren aceptación explícita', async () => {
  await withFetch(() => Response.json(order(), {status:201}), async requests => {
    const flow = checkout()
    flow.review().onTermsAcceptedChange(false); flow.render()
    await flow.review().onConfirm(); flow.render()
    assert.equal(requests.length,0)
    flow.review().onTermsAcceptedChange(true); flow.render()
    const fresh = checkout({acceptTerms:false})
    assert.equal(fresh.review().termsAccepted,false)
    await fresh.review().onConfirm()
    assert.equal(requests.length,0)
  })
})

test('CN-46 consulta y navegación entre pasos conservan datos sin aceptar automáticamente', () => {
  const flow = checkout({acceptTerms:false})
  flow.review().onOpenTerms(); flow.render()
  assert.ok(flow.find('TermsDialog'))
  assert.equal(flow.review().termsAccepted,false)
  flow.find('TermsDialog').onClose(); flow.render()
  assert.equal(flow.find('TermsDialog'),undefined)
  assert.deepEqual(flow.review().buyer,buyer)
  assert.deepEqual(flow.review().delivery,delivery)
  assert.deepEqual(flow.events,[])
  flow.review().onTermsAcceptedChange(true); flow.render()
  flow.review().onEdit('buyer'); flow.render()
  flow.find('BuyerStep').onContinue(buyer); flow.render()
  flow.find('DeliveryStep').onContinue(delivery); flow.render()
  assert.equal(flow.review().termsAccepted,true)
})

test('CN-46 doble submit y cambios programáticos no alteran el intento pendiente', async () => {
  let resolve
  await withFetch(() => new Promise(r=>{resolve=r}), async requests => {
    const flow=checkout(), review=flow.review()
    const pending=review.onConfirm()
    await review.onConfirm()
    review.onTermsAcceptedChange(false); flow.render()
    assert.equal(flow.review().termsAccepted,true)
    assert.equal(requests.length,1)
    resolve(Response.json(order(),{status:201}))
    await pending
  })
})

for (const failure of ['timeout','invalid-response','terms-ambiguous']) {
  test('CN-46 retry conserva versión y key incluso si cambia la fuente: '+failure, async () => {
    const version=termsPolicy.version
    try {
      await withFetch(count=> {
        if(count>1) return Response.json(order(),{status:201})
        if(failure==='timeout') throw new DOMException('Timeout','TimeoutError')
        if(failure==='terms-ambiguous') return Response.json({error:{code:'CHECKOUT_VALIDATION_ERROR',fieldErrors:{'termsAcceptance.version':'conflict'}}},{status:409})
        return Response.json({}, {status:201})
      }, async requests=> {
        const flow=checkout()
        await flow.review().onConfirm(); flow.render()
        const original=structuredClone(requests[0])
        termsPolicy.version='changed-after-attempt'
        flow.review().onTermsAcceptedChange(false); flow.render()
        assert.equal(flow.review().termsAccepted,true)
        assert.equal(flow.review().retryPending,true)
        assert.equal(flow.step(),'review')
        await flow.review().onConfirm(); flow.render()
        assert.deepEqual(requests[1],original)
        assert.equal(flow.step(),'payment')
      })
    } finally { termsPolicy.version=version }
  })
}

for (const field of ['termsAcceptance.accepted','termsAcceptance.version']) {
  test('CN-46 rechazo concluyente permanece en Review: '+field, async () => {
    await withFetch(count=>count===1
      ? Response.json({error:{code:'CHECKOUT_VALIDATION_ERROR',fieldErrors:{[field]:'INTERNAL'}}},{status:400})
      : Response.json(order(),{status:201}), async requests=> {
      const flow=checkout()
      await flow.review().onConfirm(); flow.render()
      assert.equal(flow.step(),'review')
      assert.equal(flow.review().termsAccepted,false)
      assert.equal(flow.review().retryPending,false)
      assert.ok(flow.review().termsError)
      assert.equal(flow.review().termsError.includes('INTERNAL'),false)
      flow.review().onTermsAcceptedChange(true); flow.render()
      if(field.endsWith('version')) {
        assert.equal(flow.review().termsAccepted,false)
        assert.ok(flow.review().termsError)
        assert.match(text(ReviewStep(flow.review())),/Versión local rechazada/)
        flow.review().onOpenTerms(); flow.render()
        assert.equal(flow.find('TermsDialog').versionRejected,true)
        flow.find('TermsDialog').onClose(); flow.render()
        await flow.review().onConfirm()
        assert.equal(requests.length,1)
      } else {
        assert.equal(flow.review().termsError,undefined)
        await flow.review().onConfirm(); flow.render()
        assert.equal(requests.length,2)
        assert.notEqual(requests[0].idempotencyKey,requests[1].idempotencyKey)
      }
    })
  })
}

test('CN-46 validación ajena a términos conserva el destino Buyer', async () => {
  await withFetch(()=>Response.json({error:{code:'CHECKOUT_VALIDATION_ERROR',fieldErrors:{'buyer.email':'Revisar'}}},{status:400}), async()=> {
    const flow=checkout()
    await flow.review().onConfirm(); flow.render()
    assert.equal(flow.step(),'buyer')
    assert.deepEqual(flow.find('BuyerStep').errors,{'buyer.email':'Revisar'})
  })
})

test('CN-46 Order existente continúa sin checkbox ni nuevo POST', async () => {
  await withFetch(()=>Response.json(order(),{status:201}), async requests=> {
    const flow=checkout()
    await flow.review().onConfirm(); flow.render()
    flow.find('button').onClick(); flow.render()
    flow.review().onTermsAcceptedChange(false); flow.render()
    assert.equal(nodes(ReviewStep(flow.review())).some(n=>n.type==='input'),false)
    await flow.review().onConfirm(); flow.render()
    assert.equal(flow.step(),'payment')
    assert.equal(requests.length,1)
  })
})
