/** Carrito para compras como invitado: CartProvider real con localStorage simulado y protección del carrito de otra identidad. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { analyticsEnvironment, dataUrl } from './helpers/analyticsHarness.mjs'
import { reactHarness } from './helpers/reactHarness.mjs'

const KEY = 'cibernova:cart:v1'
const line = { productId: 'p1', name: 'Producto', image: '', price: 10000, quantity: 1 }
const item = { productId: 'p2', name: 'Otro', image: '', price: 5000 }

async function setup(t, stored) {
  const h = await reactHarness()
  t.after(() => h.runtime.dispose())
  const env = analyticsEnvironment(t)
  if (stored !== undefined) env.stored.set(KEY, JSON.stringify(stored))
  window.addEventListener = () => {}
  window.removeEventListener = () => {}
  h.overrides.set('context/CartContext', dataUrl('export const CartContext={Provider:"CartProvider"}'))
  const { default: CartProvider } = await h.load('context/CartProvider')
  const cart = () => h.render('cart', CartProvider, { children: null }).props.value
  const saved = () => JSON.parse(env.stored.get(KEY))
  return { cart, saved }
}

test('un carrito guardado vacío de otra identidad queda disponible para el invitado', async t => {
  const { cart } = await setup(t, { schemaVersion: 2, ownerId: 'user-b2c-01', items: [] })
  assert.deepEqual([cart().ownerId, cart().isActive], [null, true])
  assert.equal(cart().addItem(item).accepted, true)
  assert.deepEqual(cart().items.map(value => value.productId), ['p2'])
})

test('cerrar sesión con el carrito vacío lo libera para el invitado', async t => {
  const { cart } = await setup(t)
  assert.equal(cart().setCartOwner('user-b2c-01'), true)
  cart().setCartOwner(null)
  assert.deepEqual([cart().ownerId, cart().isActive], [null, true], 'Vacío: el visitante puede agregar productos')
  assert.equal(cart().addItem(item).accepted, true)
})

test('cerrar sesión con productos conserva el propietario y no los expone al visitante', async t => {
  const owned = await setup(t)
  owned.cart().setCartOwner('user-b2c-01')
  assert.equal(owned.cart().addItem(item).accepted, true)
  owned.cart().setCartOwner(null)
  assert.deepEqual([owned.cart().ownerId, owned.cart().isActive, owned.cart().items.length], ['user-b2c-01', false, 0], 'Los productos de otra identidad no se exponen')
  assert.equal(owned.cart().addItem({ ...item, productId: 'p3' }).accepted, false)
})

test('sin Session, vaciar el carrito guardado de otra identidad permite comprar como invitado', async t => {
  const { cart, saved } = await setup(t, { schemaVersion: 2, ownerId: 'user-b2b-01', items: [line] })
  assert.deepEqual([cart().ownerId, cart().isActive, cart().items.length], ['user-b2b-01', false, 0])
  cart().discardForGuest()
  assert.deepEqual([cart().ownerId, cart().isActive, cart().items.length], [null, true, 0])
  assert.deepEqual(saved(), { schemaVersion: 2, ownerId: null, items: [] })
  assert.equal(cart().addItem(item).accepted, true)
})

test('con una Session activa, discardForGuest no modifica el carrito', async t => {
  const { cart } = await setup(t)
  cart().setCartOwner('user-b2c-01')
  cart().addItem(item)
  cart().discardForGuest()
  assert.deepEqual([cart().ownerId, cart().items.length], ['user-b2c-01', 1])
})

test('la página del carrito ofrece vaciar y comprar como invitado solo sin Session y con confirmación', () => {
  const source = readFileSync(new URL('../src/components/cart/CartSection.tsx', import.meta.url), 'utf8')
  assert.match(source, /\{!user \? \(confirmGuestDiscard \?/)
  assert.match(source, /Vaciar y comprar como invitado/)
  assert.match(source, /onClick=\{\(\) => \{ discardForGuest\(\); setConfirmGuestDiscard\(false\) \}\}/)
})
