/** CN-69 Browser QA. Solo consola y memoria: sin capturas, videos, trazas ni archivos de resultados. */
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { API, BASE, CLIENT, operatingEnvironment, localBrowserUrl, stackEnvironment } from './isolation.mjs'

// Selección local del runtime Playwright/Chrome; estas referencias se capturan antes de descartar el entorno heredado.
const modulePath = process.env.QA_BROWSER_MODULE
const chromePath = process.env.CHROME_PATH ?? ['C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/google-chrome'].find(existsSync)
if (!chromePath) throw new Error('CN69_BROWSER_CHROME_UNAVAILABLE')
stackEnvironment(process.env)
const clean = operatingEnvironment(process.env)
for (const key of Object.keys(process.env)) delete process.env[key]
Object.assign(process.env, clean)
const browserModule = modulePath ? await import(pathToFileURL(modulePath).href) : await import(createRequire(import.meta.url).resolve('playwright'))
const playwright = browserModule.default ?? browserModule
const results = [], apiCalls = [], errors = [], blocked = []
let child, browser, page, ready, droppedPayment = false, losePayment = false, catalogFault = false
let firstOrderHash, b2bOrderHash, adminProductHash
const wait = ms => new Promise(done => setTimeout(done, ms))
/** Acumula resultados solo en memoria/consola; level conserva el tipo de comprobación: UI, DOM o preparación API. */
async function scenario(group, name, run, level = 'Browser UI + Express / memory') {
  try { await run(); results.push({ group, name, status: 'PASS', level }); console.log('PASS ' + group + ' | ' + name) }
  catch (error) { const message = error.message.slice(0, 350); results.push({ group, name, status: 'FAIL', level, message }); console.log('FAIL ' + group + ' | ' + name + ' | ' + message) }
}
async function text(pattern) { await page.getByText(pattern).filter({ visible: true }).first().waitFor({ state: 'visible' }) }
async function button(name) { await page.getByRole('button', { name, exact: typeof name === 'string' }).filter({ visible: true }).first().click() }
async function hash(value) { await page.evaluate(value => { location.hash = value }, value); await wait(350) }
async function branch(id) {
  await page.locator('select:visible').filter({ has: page.locator('option[value="san_jose"]') }).first().selectOption(id)
  await wait(500)
}
async function login(id, label) {
  await button(/^(Iniciar sesión|Cambiar usuario)$/)
  await page.locator('dialog select, [role=dialog] select').selectOption(id)
  await button('Continuar con esta identidad')
  await wait(300)
  const consent = page.getByRole('button', { name: /carrito y continuar/ }).filter({ visible: true })
  if (await consent.count()) await consent.first().click()
  await page.locator('header:visible').getByText(label, { exact: false }).first().waitFor()
}
async function add(name) { await button('Agregar ' + name + ' al carrito'); await wait(200) }
async function pay(label) {
  const card = page.locator('input[placeholder="1234 5678 9012 3456"]:visible')
  await card.waitFor()
  if (await card.count()) {
    await card.fill('4111111111111111')
    await page.locator('input[placeholder="Nombre completo"]:visible').fill('PERSONA QA')
    await page.locator('input[placeholder="MM/AA"]:visible').fill('1230')
    await page.locator('input[placeholder="231"]:visible').fill('123')
  }
  await page.getByText(label, { exact: false }).filter({ visible: true }).last().click()
  await button(/Procesar pago/)
}
async function retry() { await button(/Intentar|Reintentar|otro pago/i); await wait(250) }
async function review() {
  await hash('#cart-page')
  await button('Finalizar compra')
  await page.getByLabel('Nombre completo', { exact: true }).fill('Persona QA')
  await page.getByLabel('Correo electrónico', { exact: true }).fill('qa@example.com')
  await page.getByLabel('Teléfono', { exact: true }).fill('88888888')
  await page.locator('button[type=submit]:visible').click()
  await page.getByLabel('Provincia', { exact: true }).fill('San José')
  await page.getByLabel('Cantón', { exact: true }).fill('Central')
  await page.getByLabel('Dirección', { exact: true }).fill('Dirección ficticia QA')
  await page.locator('button[type=submit]:visible').click()
  await text(/Confirmar y continuar al pago/)
}
/** Comprueba marcadores y geometría en cuatro viewports; incluye Escape en Mobile, sin equivaler a revisión visual humana. */
async function responsive(name) {
  const markers = { 'Confirmación': /Compra confirmada/, 'Order Detail': /Detalle de la orden/,
    'Admin Products': /Productos e inventario/, 'Admin Inventory': /Nueva cantidad simulada/,
    'Analytics': /Analytics Dashboard/, 'Carrito': /Tu carrito/, 'Review': /Cuenta y sucursal/, 'Catálogo': /Elige una sucursal/ }
  for (const [device, size] of Object.entries({ desktop: { width: 1440, height: 900 }, tablet: { width: 820, height: 1180 }, mobile: { width: 390, height: 844 }, mobile320: { width: 320, height: 780 } })) {
    await scenario('Responsive', name + ' / ' + device, async () => {
      await page.setViewportSize(size); await wait(150)
      await text(markers[name])
      const metrics = await page.evaluate(() => ({ viewport: innerWidth, body: document.documentElement.scrollWidth,
        visibleHeadings: [...document.querySelectorAll('h1,h2')].some(e => e.getClientRects().length && !e.closest('[hidden],[inert]')) }))
      assert.ok(metrics.visibleHeadings)
      assert.ok(metrics.body <= metrics.viewport + 1, 'Desbordamiento horizontal: ' + JSON.stringify(metrics))
      if (name === 'Catálogo' && device === 'mobile') {
        await button('Ver detalles de SSD NVMe 1 TB'); await page.getByRole('dialog').waitFor()
        await page.keyboard.press('Escape'); await page.getByRole('dialog').waitFor({ state: 'hidden' })
      }
    }, 'Browser DOM / layout')
  }
  await page.setViewportSize({ width: 1440, height: 900 })
}
/** Prepara o consulta fixtures mediante HTTP desde la página; se etiqueta aparte de los pasos ejecutados por la UI. */
async function apiRequest(path, userId, body) {
  return page.evaluate(async ({ url, userId, body }) => {
    const response = await fetch(url, { method: body === undefined ? 'GET' : 'POST',
      headers: { ...(userId ? { 'X-CiberNova-User-Id': userId } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
    return { status: response.status, body: await response.json() }
  }, { url: API + path, userId, body })
}
try {
  child = spawn(process.execPath, [fileURLToPath(new URL('./stack.mjs', import.meta.url))], { env: clean, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] })
  child.stdout.on('data', chunk => process.stdout.write(chunk))
  child.stderr.on('data', chunk => process.stderr.write(chunk))
  ready = await new Promise((done, reject) => {
    const timer = setTimeout(() => reject(new Error('CN69_BROWSER_STACK_TIMEOUT')), 45000)
    child.once('error', error => { clearTimeout(timer); reject(error) })
    child.once('exit', code => { clearTimeout(timer); reject(new Error('CN69_BROWSER_STACK_EXIT_' + code)) })
    child.on('message', message => { if (message?.type === 'qa-ready') { clearTimeout(timer); done(message) } })
  })
  assert.equal(ready.storage, 'memory')
  browser = await playwright.chromium.launch({ executablePath: chromePath, headless: true, env: clean,
    args: ['--disable-background-networking', '--disable-component-update', '--disable-sync', '--no-first-run',
      '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1'] })
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block' })
  await context.route('**/*', async route => {
    const request = route.request(), url = request.url()
    if (!localBrowserUrl(url)) { blocked.push(new URL(url).origin); await route.abort('blockedbyclient'); return }
    if (url.startsWith(API)) {
      const call = { url, method: request.method(), body: request.postDataJSON() }; apiCalls.push(call)
      if (catalogFault && call.method === 'GET' && new URL(url).pathname === '/api/products') {
        await wait(1500)
        await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'QA_UNAVAILABLE', message: 'No se pudieron cargar los productos de QA.' } }) }); return
      }
      // Express procesa el pago; solo se pierde la respuesta hacia el navegador para probar Replay manual con la misma key.
      if (losePayment && call.method === 'POST' && /\/payment$/.test(new URL(url).pathname)) {
        losePayment = false; const response = await route.fetch(); assert.equal(response.status(), 200)
        droppedPayment = true; await route.abort('failed'); return
      }
    }
    await route.continue()
  })
  page = await context.newPage()
  page.setDefaultTimeout(7000)
  page.on('pageerror', error => errors.push(error.message))
  page.on('dialog', dialog => dialog.accept())
  await page.goto(ready.url, { waitUntil: 'networkidle' })
  await scenario('B2C', 'Login y catálogo Retail', async () => {
    await login('qa-b2c', 'Cliente QA'); await text(/45\s?000/); await branch('san_jose')
  })
  await responsive('Catálogo')
  await scenario('Regression', 'Pagination, orden por precio y filtro de rango', async () => {
    await button('Página siguiente'); await wait(400); await button('Página anterior'); await wait(400)
    await button('Ordenar Por Precio'); await page.getByLabel('Ordenar por', { exact: true }).selectOption('price_asc'); await wait(400)
    await page.getByLabel('Hasta', { exact: true }).fill('20000'); await button('Aplicar precio'); await wait(400)
    assert.equal(await page.getByRole('button', { name: 'Agregar Laptop 14 pulgadas al carrito', exact: true }).count(), 0)
    await button('Limpiar filtros'); await button('Ordenar Por Precio'); await wait(300)
  })
  await scenario('Regression', 'Predictive Search, Recent Searches y filtro textual', async () => {
    const search = page.getByPlaceholder('Buscar laptops, componentes, accesorios...').filter({ visible: true })
    await search.fill('SSD'); await wait(600)
    await page.getByRole('listbox', { name: 'Sugerencias de productos' }).getByRole('option').first().waitFor()
    await search.press('Enter'); await wait(400)
    await text(/SSD NVMe 1 TB/)
    await search.fill(''); await wait(500)
  })
  await scenario('Regression', 'Quick View, Escape y Recently Viewed', async () => {
    await button('Ver detalles de SSD NVMe 1 TB')
    await page.getByRole('dialog').waitFor()
    await page.keyboard.press('Escape')
    await page.getByRole('dialog').waitFor({ state: 'hidden' })
    await text(/Vistos recientemente|Visitados recientemente|visto recientemente/i)
  })
  await scenario('B2C', 'Agregar productos y ajustar cantidades', async () => {
    await add('SSD NVMe 1 TB'); await add('Mouse inalámbrico'); await hash('#cart-page')
    await text(/Mouse inalámbrico/)
    const increase = page.getByRole('button', { name: /Aumentar/ }).first()
    await increase.click(); await wait(200)
    await page.getByRole('button', { name: /Disminuir/ }).first().click()
  })
  await responsive('Carrito')
  await scenario('B2C', 'Reload borra Session y restaura Cart solo para su propietario', async () => {
    await page.reload({ waitUntil: 'networkidle' }); await text(/Selecciona una identidad|Inicia.*sesión|identidad/i)
    await login('qa-b2c', 'Cliente QA'); await hash('#cart-page'); await branch('san_jose'); await text(/Mouse inalámbrico/)
  })
  await scenario('Checkout', 'Buyer, Delivery, Review y consentimiento obligatorio B2C', async () => {
    await review()
    const creations = apiCalls.filter(call => call.method === 'POST' && /\/api\/v2\/orders$/.test(new URL(call.url).pathname)).length
    await button('Confirmar y continuar al pago')
    await text(/aceptar.*términos|acepta.*términos/i)
    assert.equal(apiCalls.filter(call => call.method === 'POST' && /\/api\/v2\/orders$/.test(new URL(call.url).pathname)).length, creations)
    await text(/68\s?475/)
    await responsive('Review')
    await page.locator('input[type=checkbox]:visible').check()
    await button('Confirmar y continuar al pago'); await text(/Procesar pago/)
  })
  await scenario('Checkout', 'DECLINED y ERROR permiten Retry en la misma Order', async () => {
    await pay('Rechazar pago'); await text(/rechaz/i); await retry()
    await pay('Error del servicio'); await text(/error/i); await retry()
  })
  await scenario('Checkout', 'Respuesta APPROVED perdida y Replay manual con la misma key', async () => {
    const before = apiCalls.length; losePayment = true
    await pay('Aprobar pago'); await wait(600)
    assert.equal(droppedPayment, true)
    await button(/Procesar pago|Reintentar pago/)
    await text(/Compra confirmada/)
    const calls = apiCalls.slice(before).filter(call => /\/payment$/.test(new URL(call.url).pathname))
    assert.equal(calls.length, 2); assert.deepEqual(calls[0].body, calls[1].body)
  })
  await scenario('Checkout', 'Safe Cart Cleanup después de confirmación', async () => {
    await text(/Compra confirmada/)
    const label = await page.locator('header:visible button[data-cart-preview-trigger]').getAttribute('aria-label')
    assert.match(label, /0 productos/)
  })
  await responsive('Confirmación')
  await scenario('Orders', 'History y detalle B2C desde Express', async () => {
    await page.locator('header:visible a[href="#my-orders"]').click(); await text(/Pago aprobado/)
    await page.getByRole('link', { name: /Ver detalle/ }).first().click()
    await text(/Detalle de la orden/); firstOrderHash = await page.evaluate(() => location.hash)
  })
  await responsive('Order Detail')
  await scenario('Orders', 'Reload de detalle requiere identidad y conserva snapshot autorizado', async () => {
    assert.ok(firstOrderHash); await page.reload({ waitUntil: 'networkidle' })
    await login('qa-b2c', 'Cliente QA'); await text(/Detalle de la orden/); await text(/Productos/)
    assert.equal(await page.evaluate(() => location.hash), firstOrderHash)
  })
  await scenario('B2B', 'Wholesale, MOQ y bloqueo de producto no elegible', async () => {
    await hash('#catalog'); await login('qa-b2b', 'Compras Empresa QA'); await branch('san_jose'); await text(/39\s?000/)
    const mouse = page.getByRole('button', { name: 'Agregar Mouse inalámbrico al carrito', exact: true })
    assert.equal(await mouse.count() === 0 || await mouse.isDisabled(), true)
    await add('SSD NVMe 1 TB'); await hash('#cart-page')
    assert.equal(await page.getByRole('button', { name: /Disminuir/ }).first().isDisabled(), true)
  })
  await scenario('B2B', 'Ownership impide ver detalle B2C', async () => {
    assert.ok(firstOrderHash); await hash(firstOrderHash); await text(/no.*encontr|no.*disponible|no existe/i)
  })
  await scenario('Checkout', 'Compra B2B V2 con empresa y Wholesale', async () => {
    await hash('#cart-page'); await review(); await text(/Distribuidora QA/); await text(/Wholesale|Mayorista/i)
    await text(/132\s?210/)
    await page.locator('input[type=checkbox]:visible').check()
    await button('Confirmar y continuar al pago'); await pay('Aprobar pago'); await text(/Compra confirmada/)
    await page.locator('header:visible a[href="#my-orders"]').click(); await text(/Pago aprobado/)
    await page.getByRole('link', { name: /Ver detalle/ }).first().click(); await text(/Distribuidora QA/)
    b2bOrderHash = await page.evaluate(() => location.hash)
  })
  await scenario('B2C', 'Límite de stock en sucursal', async () => {
    await hash('#catalog'); await login('qa-b2c', 'Cliente QA'); await branch('alajuela')
    await add('SSD NVMe 1 TB'); await add('SSD NVMe 1 TB'); await hash('#cart-page')
    assert.equal(await page.getByRole('button', { name: /Aumentar/ }).first().isDisabled(), true)
  })
  await scenario('B2C', 'Otro propietario no hereda el Cart y tiene History vacío', async () => {
    await hash('#catalog'); await login('qa-b2c-2', 'Otra persona QA'); await hash('#my-orders')
    await text(/Aún no|Todavía no|No tienes|Sin órdenes|no.*órdenes/i)
    const label = await page.locator('header:visible button[data-cart-preview-trigger]').getAttribute('aria-label')
    assert.match(label, /0 productos/)
  })
  await scenario('Orders', 'Preparación sintética para Pagination administrativa', async () => {
    for (let index = 0; index < 24; index++) {
      const result = await apiRequest('/api/v2/orders', 'qa-b2c-2', { buyer: { fullName: 'Persona QA', email: 'qa@example.com', phone: '88888888' },
        delivery: { province: 'San José', canton: 'Central', address: 'Dirección QA' }, items: [{ productId: 'qa-mouse', quantity: 1 }],
        branchId: 'san_jose', idempotencyKey: 'browser-qa-pagination-' + index, termsAcceptance: { accepted: true, version: '2026-10-lab4-v1' } })
      assert.equal(result.status, 201)
    }
  }, 'Preparación API local / Memory')
  await scenario('Regression', 'Identidades inválidas y acceso a Orders ajenas se rechazan', async () => {
    assert.equal((await apiRequest('/api/session/resolve', undefined, { userId: 'qa-missing' })).status, 404)
    assert.equal((await apiRequest('/api/v2/orders/mine')).status, 401)
    assert.equal((await apiRequest('/api/v2/orders/' + decodeURIComponent(firstOrderHash.split('/').at(-1)), 'qa-b2c-2')).status, 404)
  }, 'API local desde navegador')
  await scenario('ADMIN', 'Rol administrativo no compra ni accede a My Orders', async () => {
    await hash('#catalog'); await login('qa-admin', 'Administración QA'); await hash('#my-orders'); await wait(300)
    assert.notEqual(await page.evaluate(() => location.hash), '#my-orders')
    await hash('#cart-page'); await text(/ADMIN|administrador|no.*permiso/i)
  })
  await scenario('ADMIN', 'Listado global de Orders, filtros y detalle', async () => {
    await hash('#admin/orders'); await text(/órdenes|Órdenes/); await page.getByRole('link', { name: /Ver detalle/ }).first().waitFor()
    await page.getByLabel(/Tipo de comprador/).selectOption('B2B')
    await button(/^Aplicar|^Buscar/); await text(/Distribuidora QA/)
    await page.getByRole('link', { name: /Ver detalle/ }).first().click(); await text(/Detalle de la orden/)
  })
  await scenario('ADMIN', 'Search de Orders con proyección ficticia y Pagination del Store', async () => {
    await hash('#admin/orders'); await button('Siguiente'); await wait(300); await button('Anterior')
    const response = page.waitForResponse(value => new URL(value.url()).pathname === '/api/v2/admin/orders' && new URL(value.url()).searchParams.get('q') === 'Distribuidora')
    await page.getByPlaceholder('Ej. CN-2026 o Distribuidora').fill('Distribuidora'); await button('Aplicar búsqueda')
    assert.equal((await response).status(), 200)
    await text(/Distribuidora QA/)
    const sort = page.locator('select:visible').filter({ has: page.locator('option[value="search"]') })
    assert.equal(await sort.inputValue(), 'search'); assert.equal(await sort.isDisabled(), true)
    await button('Limpiar filtros')
  })
  await scenario('ADMIN', 'Admin Products busca SKU literal con puntos', async () => {
    await hash('#admin/products')
    await page.getByPlaceholder('Ej. SSD, Logitech o SAM-DIS-0214').fill('G.S-MEM-0118')
    await button(/^Buscar/); await page.getByRole('link', { name: /Ver detalle administrativo de SSD/ }).waitFor()
  })
  await responsive('Admin Products')
  await scenario('ADMIN', 'Detalle de inventario, confirmación, simulación y Reset', async () => {
    await page.getByRole('link', { name: /Ver detalle administrativo de SSD/ }).click()
    adminProductHash = await page.evaluate(() => location.hash)
    const writesBefore = apiCalls.filter(call => call.method !== 'GET').length
    await page.getByRole('form', { name: 'Nueva cantidad simulada' }).locator('select').selectOption('san_jose')
    await page.getByRole('form', { name: 'Nueva cantidad simulada' }).locator('input').fill('7')
    await button(/Revisar simulación/); await text(/Confirmar simulación/)
    await button('Confirmar simulación'); await text(/Simulación aplicada/)
    await button('Restablecer simulación del producto'); await text(/Se descartaron las simulaciones/)
    assert.equal(apiCalls.filter(call => call.method !== 'GET').length, writesBefore, 'La simulación no escribe en el Server.')
    await page.getByRole('form', { name: 'Nueva cantidad simulada' }).locator('input').fill('9')
    await button('Revisar simulación'); await button('Confirmar simulación'); await text(/Simulación aplicada/)
  })
  await responsive('Admin Inventory')
  await scenario('Regression', 'ADMIN Analytics Dashboard y actividad local', async () => {
    await hash('#analytics'); await text(/Analytics Dashboard/)
    await text(/Visualizaciones|Vistas|Productos vistos/); await text(/Compras completadas|Compras/i)
    const types = await page.evaluate(() => {
      const events = []; const visit = value => { if (!value || typeof value !== 'object') return; if (value.schemaVersion === 2 && typeof value.type === 'string') events.push(value.type); for (const item of Object.values(value)) visit(item) }
      for (const key of Object.keys(localStorage)) { if (!key.includes('analytics')) continue; try { visit(JSON.parse(localStorage.getItem(key))) } catch {} }
      return events
    })
    for (const type of ['SESSION_STARTED', 'SEARCH_PERFORMED', 'PRODUCT_VIEWED', 'CART_ITEM_ADDED', 'CHECKOUT_STARTED', 'PURCHASE_COMPLETED']) assert.ok(types.includes(type), 'Falta ' + type)
    assert.equal(types.filter(type => type === 'PURCHASE_COMPLETED').length, 2, 'Replay no duplica la compra completada.')
  })
  await responsive('Analytics')
  await scenario('Regression', 'Cambio Session invalida ADMIN y sus simulaciones', async () => {
    await login('qa-b2c', 'Cliente QA'); await hash('#admin/products'); await wait(300)
    assert.notEqual(await page.evaluate(() => location.hash), '#admin/products')
    await hash('#analytics'); assert.notEqual(await page.evaluate(() => location.hash), '#analytics')
    await login('qa-admin', 'Administración QA'); await hash(adminProductHash); await text(/Simular existencias por sucursal/)
    assert.equal(await page.getByRole('button', { name: 'Restablecer simulación del producto', exact: true }).count(), 0)
    await hash('#catalog'); await login('qa-b2c', 'Cliente QA')
  })
  await scenario('Regression', 'Teclado y foco visible', async () => {
    await hash('#catalog'); await page.keyboard.press('Tab')
    const focused = await page.evaluate(() => {
      const e = document.activeElement, s = getComputedStyle(e)
      return { tag: e.tagName, visible: e.getClientRects().length > 0, indicator: s.outlineStyle !== 'none' || s.boxShadow !== 'none' }
    })
    assert.notEqual(focused.tag, 'BODY'); assert.ok(focused.visible); assert.ok(focused.indicator)
  })
  await scenario('Regression', 'Empty, Loading, Error y recuperación del catálogo', async () => {
    const search = page.getByPlaceholder('Buscar laptops, componentes, accesorios...').filter({ visible: true })
    await search.fill('QA-producto-inexistente'); await text(/No encontramos productos/)
    await search.fill(''); await wait(350)
    catalogFault = true; await page.reload({ waitUntil: 'domcontentloaded' }); await text(/Cargando productos/)
    await text(/No se pudieron|Error|ocurrió un error/i)
    catalogFault = false
    await page.reload({ waitUntil: 'networkidle' }); await text(/SSD NVMe 1 TB/)
  }, 'Browser UI con fallo HTTP simulado')
  await scenario('Regression', 'Sin errores React ni datos de tarjeta transmitidos', async () => {
    assert.deepEqual(errors, [])
    assert.ok(apiCalls.every(call => !JSON.stringify(call.body ?? {}).includes('4111111111111111')))
  })
  // El E2E-20 de API no convierte este recorrido Browser In-Memory en evidencia de persistencia PostgreSQL.
  results.push({ group: 'Orders', name: 'Durabilidad tras reiniciar Server / PostgreSQL', status: 'BLOCKED', level: 'Browser E2E PostgreSQL', message: 'Sin recurso PostgreSQL efímero autorizado para Browser QA.' })
} catch (error) {
  results.push({ group: 'Environment', name: 'Arranque/ejecución controlada', status: 'FAIL', message: error.message })
  console.error('CN69_BROWSER_ERROR ' + error.message)
} finally {
  // Cierra Chrome y solicita cleanup al stack propio; una salida no exitosa o el vencimiento del plazo se registra como FAIL.
  try { await browser?.close() } catch { results.push({ group: 'Environment', name: 'Cierre de Chrome', status: 'FAIL' }) }
  if (child && child.exitCode === null && child.connected) {
    await new Promise(done => {
      const timer = setTimeout(() => { child.kill(); results.push({ group: 'Environment', name: 'Cleanup incompleto del stack', status: 'FAIL' }); done() }, 5000)
      child.once('exit', () => { clearTimeout(timer); done() })
      child.send('qa-stop')
    })
  }
  if (child && child.exitCode !== 0) results.push({ group: 'Environment', name: 'Salida del stack / auditoría de aislamiento', status: 'FAIL', message: 'exit=' + child.exitCode })
  console.log('CN69_BROWSER_SUMMARY ' + JSON.stringify({ results, blockedRequests: blocked, pageErrors: errors,
    apiRequests: apiCalls.length, storage: 'memory', screenshots: false, videos: false }))
  if (results.some(result => result.status === 'FAIL')) process.exitCode = 1
}
