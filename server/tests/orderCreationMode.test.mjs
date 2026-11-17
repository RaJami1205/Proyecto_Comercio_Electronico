/** Configuración de transición HTTP. No importa stores, abre conexiones ni carga .env privado. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'

let sequence = 0
async function config(t, mode, storage = 'memory') {
  const previous = new Map(['ORDER_CREATION_MODE', 'COMMERCE_STORE_MODE', 'DOTENV_CONFIG_PATH'].map(key => [key, process.env[key]]))
  t.after(() => {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  })
  process.env.DOTENV_CONFIG_PATH = fileURLToPath(new URL('../.env.database.example', import.meta.url))
  if (mode === undefined) delete process.env.ORDER_CREATION_MODE
  else process.env.ORDER_CREATION_MODE = mode
  process.env.COMMERCE_STORE_MODE = storage
  return import(new URL(`../dist/config/env.js?cn61-mode=${sequence++}`, import.meta.url))
}

for (const mode of [undefined, '', 'v1-compatible', ' v2-only ']) {
  test('modo de creación explícito o default: ' + String(mode), async t => {
    const { serverConfig } = await config(t, mode)
    assert.equal(serverConfig.orderCreationMode, mode?.trim() || 'v1-compatible')
    assert.equal(serverConfig.commerceStoreMode, 'memory')
  })
}

test('un modo desconocido falla cerrado al iniciar', async t => {
  await assert.rejects(config(t, 'arbitrary'), { name: 'ConfigurationError' })
})

test('el protocolo HTTP no se deriva de la selección PostgreSQL', async t => {
  const { serverConfig } = await config(t, 'v1-compatible', 'postgresql')
  assert.equal(serverConfig.commerceStoreMode, 'postgresql')
  assert.equal(serverConfig.orderCreationMode, 'v1-compatible')
})
