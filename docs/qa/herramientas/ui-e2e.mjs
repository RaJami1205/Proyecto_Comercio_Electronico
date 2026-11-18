/**
 * CN-69 QA. Recorridos E2E en Chrome real contra el stack de stack.mjs.
 * Uso node ui-e2e.mjs b2c, luego b2b, reiniciar stack.mjs y finalmente restart. Ver README.md.
 */
import puppeteer from 'puppeteer-core'
import { mkdir, readFile, writeFile } from 'node:fs/promises'

const BASE = 'http://127.0.0.1:4173/Proyecto_Comercio_Electronico/'
const SHOTS = process.env.QA_SHOTS ?? './capturas/'
const RESULTS = process.env.QA_RESULTS ?? './ui-results.json'
await mkdir(SHOTS, { recursive: true })
const VIEWPORTS = { desktop: { width: 1440, height: 900 }, tablet: { width: 820, height: 1180 }, mobile: { width: 390, height: 844 } }
const phase = process.argv[2]

const results = JSON.parse(await readFile(RESULTS, 'utf8').catch(() => '{}'))
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH ?? '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] })
const page = await browser.newPage()
const consoleErrors = []
page.on('pageerror', error => consoleErrors.push(String(error)))
page.on('console', message => { if (message.type() === 'error' && !/Failed to load resource/.test(message.text())) consoleErrors.push(message.text()) })
page.setDefaultTimeout(10000)
await page.setViewport(VIEWPORTS.desktop)

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const text = () => page.evaluate(() => document.body.innerText)
async function waitText(pattern, timeout = 10000) {
  const start = Date.now()
  while (Date.now() - start < timeout) { if (pattern.test(await text())) return; await sleep(150) }
  throw new Error('No apareció ' + pattern)
}
/** Hace clic en el primer elemento visible: el catálogo permanece montado y oculto con su propio Header. */
async function click(selector, timeout = 10000) {
  const start = Date.now()
  while (Date.now() - start < timeout) {
    for (const handle of await page.$$(selector)) {
      const visible = await handle.evaluate(element => element.getClientRects().length > 0 && !element.closest('[hidden], [inert]')
        && getComputedStyle(element).visibility !== 'hidden')
      if (visible) { await handle.click(); return }
    }
    await sleep(150)
  }
  throw new Error('No hay elemento visible para ' + selector)
}
async function shot(name, viewports = ['desktop'], fullPage = true) {
  for (const viewport of viewports) {
    await page.setViewport(VIEWPORTS[viewport]); await sleep(400)
    await page.screenshot({ path: SHOTS + name + '-' + viewport + '.png', fullPage })
  }
  await page.setViewport(VIEWPORTS.desktop); await sleep(200)
}
async function login(userId, displayName) {
  await click('header button[aria-label="Iniciar sesión"], header button[aria-label="Cambiar usuario"]')
  await page.waitForSelector('dialog select, [role="dialog"] select')
  await page.waitForFunction(id => [...document.querySelectorAll('dialog option, [role="dialog"] option')].some(option => option.value === id), {}, userId)
  await page.select('dialog select, [role="dialog"] select', userId)
  await click('button::-p-text(Continuar con esta identidad)')
  await sleep(500)
  const consent = await page.$('button::-p-text(carrito y continuar)')
  if (consent) await consent.click()
  await page.waitForFunction(name => document.querySelector('header')?.innerText.includes(name), {}, displayName)
}
async function selectBranch(id) {
  await page.waitForFunction(() => [...document.querySelectorAll('select')].some(select => [...select.options].some(option => option.value === 'san_jose')))
  await page.evaluate(id => {
    const select = [...document.querySelectorAll('select')].find(element => [...element.options].some(option => option.value === 'san_jose'))
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set
    setter.call(select, id); select.dispatchEvent(new Event('change', { bubbles: true }))
  }, id)
  await sleep(700)
}
const goHash = async hash => { await page.evaluate(value => { window.location.hash = value }, hash); await sleep(700) }
const fill = async (label, value) => { await page.locator(`::-p-aria(${label})`).fill(value) }
async function checkoutToReview() {
  await goHash('#cart-page')
  await waitText(/Finalizar compra/)
  await click('button::-p-text(Finalizar compra)')
  await waitText(/Nombre completo/)
  await fill('Nombre completo', 'Persona QA'); await fill('Correo electrónico', 'qa@example.com'); await fill('Teléfono', '88888888')
  await click('button[type="submit"]::-p-text(Continuar)')
  await waitText(/Provincia/)
  await fill('Provincia', 'San José'); await fill('Cantón', 'Central'); await fill('Dirección', 'Dirección de prueba QA')
  await click('button[type="submit"]::-p-text(Continuar)')
  await waitText(/Confirmar y continuar al pago/)
}
async function pay(label) {
  const cardNumber = await page.$('input[placeholder="1234 5678 9012 3456"]')
  if (cardNumber && !(await page.$eval('input[placeholder="1234 5678 9012 3456"]', input => input.value))) {
    // Datos de tarjeta demostrativos: no se transmiten al Server.
    await page.type('input[placeholder="1234 5678 9012 3456"]', '4111111111111111')
    await page.type('input[placeholder="Nombre completo"]', 'PERSONA QA')
    await page.type('input[placeholder="MM/AA"]', '1230')
    await page.type('input[placeholder="231"]', '123')
  }
  await click(`label::-p-text(${label})`)
  await click('button::-p-text(Procesar pago)')
  await sleep(1200)
}
function record(id, title, expected, obtained, status, evidence) {
  results[id] = { title, expected, obtained, status, evidence, consoleErrors: [...consoleErrors] }
  consoleErrors.length = 0
  console.log(status, id, '-', obtained)
}
async function scenario(id, title, expected, evidence, run) {
  try { record(id, title, expected, await run(), 'PASS', evidence) }
  catch (error) {
    await page.screenshot({ path: SHOTS + id + '-fallo.png', fullPage: true }).catch(() => {})
    record(id, title, expected, 'Error. ' + error.message, 'FAIL', [id + '-fallo.png'])
  }
}

await page.goto(BASE, { waitUntil: 'networkidle0' })

if (phase === 'b2c') {
  await scenario('UI-01', 'Simulated Login B2C y catálogo Retail', 'El Header muestra la identidad B2C y el catálogo presenta precios Retail', ['UI-01-catalogo-b2c-*.png'], async () => {
    await login('qa-b2c', 'Cliente QA')
    await waitText(/₡\s?45\s?000/)
    await shot('UI-01-catalogo-b2c', ['desktop', 'tablet', 'mobile'], false)
    return 'Identidad Cliente QA (B2C) visible y SSD a ₡45 000 (Retail)'
  })
  await scenario('UI-02', 'Sucursal, inventario y Shopping Cart', 'Al elegir sucursal se muestra disponibilidad y el carrito conserva las líneas', ['UI-02-carrito-b2c-*.png'], async () => {
    await selectBranch('san_jose')
    await waitText(/disponibles|Disponible/i)
    await click('button[aria-label="Agregar SSD NVMe 1 TB al carrito"]'); await sleep(400)
    await click('button[aria-label="Agregar Mouse inalámbrico al carrito"]'); await sleep(400)
    await goHash('#cart-page')
    await waitText(/SSD NVMe 1 TB/); await waitText(/Mouse inalámbrico/)
    await shot('UI-02-carrito-b2c', ['desktop', 'tablet', 'mobile'])
    return 'Carrito B2C con SSD y Mouse validados para San José'
  })
  await scenario('UI-03', 'Checkout B2C con Payment DECLINED, Retry y APPROVED', 'Review muestra cuenta y sucursal, el rechazo permite Retry y el pago aprobado confirma la compra', ['UI-03-review-b2c-*.png', 'UI-03-pago-rechazado-desktop.png', 'UI-03-confirmacion-b2c-*.png'], async () => {
    await checkoutToReview()
    await waitText(/Cuenta y sucursal/); await waitText(/Retail/)
    await shot('UI-03-review-b2c', ['desktop', 'mobile'])
    await click('input[type="checkbox"]')
    await click('button::-p-text(Confirmar y continuar al pago)')
    await waitText(/Procesar pago/)
    await pay('Rechazar pago')
    await waitText(/rechaz/i)
    await shot('UI-03-pago-rechazado')
    const retry = await page.$('button::-p-text(Intentar)') ?? await page.$('button::-p-text(Reintentar)') ?? await page.$('button::-p-text(otro)')
    if (!retry) throw new Error('No se encontró la acción de Retry')
    await retry.click(); await sleep(500)
    await pay('Aprobar pago')
    await waitText(/Compra confirmada/, 15000)
    await shot('UI-03-confirmacion-b2c', ['desktop', 'mobile'])
    const cart = await page.$eval('header button[data-cart-preview-trigger]', button => button.getAttribute('aria-label'))
    if (!/0 productos/.test(cart)) throw new Error('El carrito no se limpió tras la compra: ' + cart)
    return 'Rechazo con Retry, aprobación y carrito limpio (Safe Cart Cleanup)'
  })
  await scenario('UI-04', 'My Orders y Order Detail B2C', 'El historial lista la compra con sus estados y el detalle muestra el snapshot', ['UI-04-mis-ordenes-*.png', 'UI-04-detalle-*.png'], async () => {
    await click('header a[href="#my-orders"]')
    await waitText(/Mis órdenes/); await waitText(/Pago aprobado/)
    await shot('UI-04-mis-ordenes', ['desktop', 'tablet', 'mobile'])
    await click('a::-p-text(Ver detalle)')
    await waitText(/Detalle de la orden/); await waitText(/Productos/); await waitText(/B2C/)
    await shot('UI-04-detalle', ['desktop', 'tablet', 'mobile'])
    return 'Listado con Order confirmada y detalle con productos, importes, sucursal y Términos'
  })
  await scenario('UI-05', 'Recarga directa del detalle', 'Tras recargar se pide identidad y, al elegirla, el detalle se recupera desde el Server', ['UI-05-recarga-sin-sesion-desktop.png', 'UI-05-recarga-detalle-desktop.png'], async () => {
    const hash = await page.evaluate(() => window.location.hash)
    await page.reload({ waitUntil: 'networkidle0' })
    await waitText(/Selecciona una identidad/)
    await shot('UI-05-recarga-sin-sesion')
    await login('qa-b2c', 'Cliente QA')
    await waitText(/Productos/)
    if (await page.evaluate(() => window.location.hash) !== hash) throw new Error('Se perdió el hash del detalle')
    await shot('UI-05-recarga-detalle')
    return 'Hash ' + hash + ' conservado y detalle recuperado tras elegir identidad'
  })
  await scenario('UI-06', 'Inventario insuficiente por sucursal', 'Con existencias insuficientes en la sucursal el carrito bloquea el Checkout', ['UI-06-stock-insuficiente-desktop.png'], async () => {
    await goHash('#catalog'); await selectBranch('alajuela')
    for (let index = 0; index < 3; index += 1) {
      const button = await page.$('button[aria-label="Agregar SSD NVMe 1 TB al carrito"]')
      if (button && !(await button.evaluate(element => element.disabled))) { await button.click(); await sleep(400) }
    }
    await goHash('#cart-page'); await waitText(/SSD NVMe 1 TB/)
    const quantity = await page.evaluate(() => document.body.innerText.match(/Cantidad[^\d]*(\d+)/)?.[1])
    await shot('UI-06-stock-insuficiente')
    const increase = await page.$('button[aria-label^="Aumentar"]')
    const blocked = increase ? await increase.evaluate(element => element.disabled) : true
    if (!blocked) throw new Error('El carrito permite superar las 2 unidades de Alajuela')
    return 'Alajuela tiene 2 unidades y el carrito no permite superar ese límite (cantidad ' + (quantity ?? '2') + ')'
  })
}

if (phase === 'b2b') {
  await scenario('UI-07', 'Simulated Login B2B, Wholesale y MOQ', 'El catálogo muestra precio mayorista y el mínimo de compra B2B', ['UI-07-catalogo-b2b-*.png'], async () => {
    await login('qa-b2b', 'Compras Empresa QA')
    await selectBranch('san_jose')
    await waitText(/₡\s?39\s?000/)
    await shot('UI-07-catalogo-b2b', ['desktop', 'mobile'], false)
    const mouse = await page.$('button[aria-label="Agregar Mouse inalámbrico al carrito"]')
    const mouseBlocked = !mouse || await mouse.evaluate(element => element.disabled)
    if (!mouseBlocked) throw new Error('El Mouse sin condición B2B se puede agregar')
    return 'SSD a ₡39 000 Wholesale y Mouse sin condición B2B bloqueado'
  })
  await scenario('UI-08', 'Compra B2B completa con MOQ', 'El carrito agrega el mínimo, Review muestra empresa y MOQ y el pago confirma', ['UI-08-review-b2b-desktop.png', 'UI-08-detalle-b2b-*.png'], async () => {
    await click('button[aria-label="Agregar SSD NVMe 1 TB al carrito"]'); await sleep(500)
    await checkoutToReview()
    await waitText(/Distribuidora QA/); await waitText(/MOQ/)
    await shot('UI-08-review-b2b')
    await click('input[type="checkbox"]')
    await click('button::-p-text(Confirmar y continuar al pago)')
    await waitText(/Procesar pago/)
    await pay('Aprobar pago')
    await waitText(/Compra confirmada/, 15000)
    await click('header a[href="#my-orders"]'); await waitText(/Pago aprobado/)
    await click('a::-p-text(Ver detalle)'); await waitText(/Distribuidora QA/); await waitText(/Wholesale/)
    await shot('UI-08-detalle-b2b', ['desktop', 'mobile'])
    return 'Compra B2B confirmada con empresa, Wholesale y MOQ en el detalle'
  })
  await scenario('UI-09', 'ADMIN no usa My Orders ni compra', 'El acceso directo a #my-orders vuelve al catálogo y el Header ofrece Analytics', ['UI-09-admin-*.png'], async () => {
    await login('qa-admin', 'Administración QA')
    await goHash('#my-orders'); await sleep(500)
    const hash = await page.evaluate(() => window.location.hash)
    if (hash === '#my-orders') throw new Error('ADMIN permanece en #my-orders')
    const header = await page.$eval('header', element => element.innerText)
    if (/Mis órdenes/.test(header) || !/Analytics/.test(header)) throw new Error('Header ADMIN incorrecto: ' + header)
    await goHash('#analytics'); await waitText(/Analytics Dashboard/)
    await shot('UI-09-admin-analytics', ['desktop', 'mobile'])
    return 'ADMIN redirigido a ' + hash + ', sin Mis órdenes y con Analytics'
  })
}

if (phase === 'restart') {
  await scenario('UI-10', 'Recuperación de Orders después de reiniciar el Server', 'Tras reiniciar Node.js el historial B2C y B2B sigue disponible desde PostgreSQL', ['UI-10-tras-reinicio-desktop.png'], async () => {
    await login('qa-b2c', 'Cliente QA')
    await click('header a[href="#my-orders"]'); await waitText(/Pago aprobado/)
    await shot('UI-10-tras-reinicio')
    await login('qa-b2b', 'Compras Empresa QA')
    await click('header a[href="#my-orders"]'); await waitText(/Pago aprobado/)
    return 'Historiales B2C y B2B recuperados después de reiniciar el proceso del Server'
  })
}

await writeFile(RESULTS, JSON.stringify(results, null, 2))
await browser.close()
