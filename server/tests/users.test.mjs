/** Verifica índice users, UserService, endpoints y guardas del seed con datos simulados, sin requests a Algolia. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import app from '../dist/app.js'
import { getAlgoliaConfig, getAlgoliaUsersConfig, ConfigurationError } from '../dist/config/env.js'
import { findUserSeedErrors, parseUserRecord } from '../dist/domain/userValidation.js'
import { createAlgoliaUserDirectory, UserService, userService } from '../dist/services/userService.js'

const consumer = { objectID: 'user-b2c-01', displayName: 'Cliente', role: 'B2C', enabled: true }
const business = { objectID: 'user-b2b-01', displayName: 'Compras', role: 'B2B', enabled: true, company: { id: 'company-1', name: 'Empresa' } }
const admin = { objectID: 'user-admin-01', displayName: 'Administración', role: 'ADMIN', enabled: true }
const disabled = { ...consumer, objectID: 'user-off', enabled: false }
const unknownRole = { ...consumer, objectID: 'user-guest', role: 'GUEST' }
const invalidB2B = { ...business, objectID: 'user-b2b-bad', company: { id: 'company-1' } }
const records = [consumer, business, admin, disabled, unknownRole, invalidB2B]

/** Crea un directorio en memoria que conserva la distinción entre listado y consulta por ID. */
const directoryOf = (items) => ({
  list: async () => items,
  find: async id => items.find(item => item.objectID === id),
})
const serviceOf = (items = records) => new UserService(directoryOf(items))
/** Reemplaza variables de entorno durante una prueba y las restaura al terminar. */
function withEnv(values, run) {
  const previous = Object.fromEntries(Object.keys(values).map(key => [key, process.env[key]]))
  const assign = entries => { for (const [key, value] of Object.entries(entries)) { if (value === undefined) delete process.env[key]; else process.env[key] = value } }
  assign(values)
  const restore = () => assign(previous)
  try {
    const result = run()
    if (result instanceof Promise) return result.finally(restore)
    restore()
    return result
  } catch (error) { restore(); throw error }
}
const algoliaEnv = { ALGOLIA_APP_ID: 'app', ALGOLIA_API_KEY: 'key', ALGOLIA_INDEX_NAME: 'products', ALGOLIA_USERS_INDEX_NAME: 'users' }

test('parseUserRecord produce perfiles públicos sin enabled ni campos adicionales', () => {
  assert.deepEqual(parseUserRecord({ ...consumer, _highlightResult: {}, email: 'x@example.com' }), {
    enabled: true, user: { id: 'user-b2c-01', displayName: 'Cliente', role: 'B2C' },
  })
  assert.deepEqual(parseUserRecord(business).user, { id: 'user-b2b-01', displayName: 'Compras', role: 'B2B', company: { id: 'company-1', name: 'Empresa' } })
  assert.deepEqual(parseUserRecord(admin).user, { id: 'user-admin-01', displayName: 'Administración', role: 'ADMIN' })
})

test('parseUserRecord rechaza roles, Company y campos inválidos con códigos tipados', () => {
  const company = business.company
  for (const [record, code] of [
    [unknownRole, 'UNKNOWN_USER_ROLE'],
    [invalidB2B, 'INVALID_B2B_DATA'],
    [{ ...business, company: undefined }, 'INVALID_B2B_DATA'],
    [{ ...consumer, company }, 'INVALID_USER_DATA'],
    [{ ...admin, company }, 'INVALID_USER_DATA'],
    [{ ...consumer, displayName: ' ' }, 'INVALID_USER_DATA'],
    [{ ...consumer, enabled: 'true' }, 'INVALID_USER_DATA'],
    [{ ...consumer, objectID: 'a/b' }, 'INVALID_USER_DATA'],
    [null, 'INVALID_USER_DATA'],
    [[], 'INVALID_USER_DATA'],
  ]) assert.throws(() => parseUserRecord(record), { name: 'UserError', code })
})

test('listSelectable devuelve solo identidades habilitadas y válidas con campos permitidos', async () => {
  const users = await serviceOf().listSelectable()
  assert.deepEqual(users.map(user => user.id), ['user-b2c-01', 'user-b2b-01', 'user-admin-01'])
  for (const user of users) {
    assert.deepEqual(Object.keys(user).sort(), user.role === 'B2B' ? ['company', 'displayName', 'id', 'role'] : ['displayName', 'id', 'role'])
  }
})

test('resolve devuelve el perfil validado y rechaza cada caso inválido', async () => {
  assert.deepEqual(await serviceOf().resolve('user-b2b-01'), parseUserRecord(business).user)
  for (const [userId, status, code] of [
    ['missing', 404, 'USER_NOT_FOUND'],
    ['', 400, 'INVALID_USER_ID'],
    [undefined, 400, 'INVALID_USER_ID'],
    [7, 400, 'INVALID_USER_ID'],
    [{ id: 'user-b2c-01' }, 400, 'INVALID_USER_ID'],
    ['../products', 400, 'INVALID_USER_ID'],
    ['x'.repeat(65), 400, 'INVALID_USER_ID'],
    ['user-off', 403, 'USER_DISABLED'],
    ['user-guest', 422, 'UNKNOWN_USER_ROLE'],
    ['user-b2b-bad', 422, 'INVALID_B2B_DATA'],
  ]) await assert.rejects(serviceOf().resolve(userId), { status, code })
})

test('un fallo del directorio se traduce a 503 sin exponer detalles', async () => {
  const failure = async () => { throw new Error('SECRET_INTERNAL_DETAIL') }
  const service = new UserService({ list: failure, find: failure })
  const original = console.error
  console.error = () => {}
  try {
    for (const operation of [() => service.listSelectable(), () => service.resolve('user-b2c-01')]) {
      await assert.rejects(operation(), error => {
        assert.equal(error.status, 503)
        assert.equal(error.code, 'USER_SERVICE_UNAVAILABLE')
        assert.ok(!error.message.includes('SECRET'))
        return true
      })
    }
  } finally { console.error = original }
})

test('el directorio de Algolia consulta solo el índice users y distingue 404 de otros fallos', () => withEnv(algoliaEnv, async () => {
  const calls = []
  let failure = null
  const directory = createAlgoliaUserDirectory(() => ({
    searchSingleIndex: async request => { calls.push(request); return { hits: [consumer] } },
    getObject: async request => { calls.push(request); if (failure) throw failure; return consumer },
  }))
  assert.deepEqual(await directory.list(), [consumer])
  assert.deepEqual(await directory.find('user-b2c-01'), consumer)
  assert.deepEqual(calls.map(call => call.indexName), ['users', 'users'])
  assert.ok(calls[0].searchParams.attributesToRetrieve.includes('enabled'))
  assert.equal(calls[1].objectID, 'user-b2c-01')
  failure = Object.assign(new Error('missing'), { status: 404 })
  assert.equal(await directory.find('missing'), undefined)
  failure = Object.assign(new Error('forbidden'), { status: 403 })
  await assert.rejects(directory.find('user-b2c-01'), { status: 403 })
}))

test('la configuración de users es independiente del catálogo y no admite colisiones', () => {
  withEnv({ ...algoliaEnv, ALGOLIA_USERS_INDEX_NAME: undefined }, () => {
    assert.deepEqual(getAlgoliaConfig(), { appId: 'app', apiKey: 'key', indexName: 'products' })
    assert.throws(getAlgoliaUsersConfig, ConfigurationError)
  })
  withEnv(algoliaEnv, () => assert.deepEqual(getAlgoliaUsersConfig(), { indexName: 'users' }))
  for (const name of ['products', 'products_price_asc', 'products_price_desc']) {
    withEnv({ ...algoliaEnv, ALGOLIA_USERS_INDEX_NAME: name }, () => assert.throws(getAlgoliaUsersConfig, ConfigurationError))
  }
})

test('el dataset inicial cumple los contratos con identidades estables para cada rol', () => {
  const dataset = JSON.parse(readFileSync(new URL('../data/users.json', import.meta.url), 'utf8'))
  assert.deepEqual(findUserSeedErrors(dataset), [])
  const entries = dataset.map(parseUserRecord)
  const enabledRoles = entries.filter(entry => entry.enabled).map(entry => entry.user.role)
  for (const role of ['B2C', 'B2B', 'ADMIN']) assert.ok(enabledRoles.includes(role))
  assert.ok(entries.find(entry => entry.user.role === 'B2B').user.company.name)
  assert.ok(entries.some(entry => !entry.enabled))
})

test('la validación del seed rechaza duplicados, campos sensibles, roles y cobertura incompleta', () => {
  const valid = [consumer, business, admin]
  assert.deepEqual(findUserSeedErrors(valid), [])
  assert.deepEqual(findUserSeedErrors([]), ['se requiere un array no vacío'])
  assert.deepEqual(findUserSeedErrors({}), ['se requiere un array no vacío'])
  assert.deepEqual(findUserSeedErrors([...valid, consumer]), ['record 4: objectID duplicado'])
  assert.deepEqual(findUserSeedErrors([...valid, { ...admin, objectID: 'user-2', password: 'x' }]), ['record 4: campo no permitido password'])
  assert.deepEqual(findUserSeedErrors([...valid, { ...business, objectID: 'user-3', company: { ...business.company, taxId: '1' } }]), ['record 4: campo no permitido company.taxId'])
  assert.deepEqual(findUserSeedErrors([...valid, unknownRole]), ['record 4: UNKNOWN_USER_ROLE'])
  assert.deepEqual(findUserSeedErrors([consumer, business]), ['falta un usuario habilitado con rol ADMIN'])
  assert.deepEqual(findUserSeedErrors([consumer, business, { ...admin, enabled: false }]), ['falta un usuario habilitado con rol ADMIN'])
  assert.ok(!findUserSeedErrors([...valid, { ...admin, objectID: 'user-2', password: 'SECRET_VALUE' }]).join().includes('SECRET_VALUE'))
})

/** Ejecuta el seed compilado con credenciales ficticias; las guardas abortan antes de crear un cliente. */
const runSeed = (args, env = {}) => spawnSync(process.execPath, [fileURLToPath(new URL('../dist/scripts/seedUsers.js', import.meta.url)), ...args], {
  encoding: 'utf8',
  env: { PATH: process.env.PATH, ALGOLIA_APP_ID: 'fake-app', ALGOLIA_SEED_API_KEY: 'fake-key', ...env },
})

test('el seed usa dry-run por defecto y sus guardas abortan sin escribir', () => {
  const dryRun = runSeed([])
  assert.equal(dryRun.status, 0, dryRun.stderr)
  assert.match(dryRun.stdout, /Records: 4; validation: PASS/)
  assert.match(dryRun.stdout, /DRY RUN; network writes = 0/)

  const env = { ALGOLIA_INDEX_NAME: 'products', ALGOLIA_USERS_INDEX_NAME: 'users-test' }
  for (const [args, overrides, message] of [
    [['--confirm-index=users-test'], {}, /--confirm-index requiere --write/],
    [['--unknown'], {}, /Argumento desconocido/],
    [['--write'], {}, /--confirm-index/],
    [['--write', '--confirm-index=products'], {}, /--confirm-index/],
    [['--write', '--confirm-index=products'], { ALGOLIA_USERS_INDEX_NAME: 'products' }, /índice de productos/],
    [['--write', '--confirm-index=products_price_asc'], { ALGOLIA_USERS_INDEX_NAME: 'products_price_asc' }, /índice de productos/],
    [['--write', '--confirm-index=users-test'], { ALGOLIA_SEED_API_KEY: ' ' }, /ALGOLIA_SEED_API_KEY/],
    [['--write', '--confirm-index=users-test'], { ALGOLIA_INDEX_NAME: ' ' }, /ALGOLIA_INDEX_NAME/],
  ]) {
    const result = runSeed(args, { ...env, ...overrides })
    assert.equal(result.status, 1, args.join(' '))
    assert.match(result.stderr, message)
    assert.ok(!result.stdout.includes('Mode: WRITE'))
    assert.ok(!result.stderr.includes('fake-key'))
  }
})

test('endpoints: contratos públicos, errores tipados y ausencia de sesiones', async () => {
  const original = userService.directory
  userService.directory = directoryOf(records)
  const server = app.listen(0, '127.0.0.1')
  await new Promise(resolve => server.once('listening', resolve))
  const base = 'http://127.0.0.1:' + server.address().port + '/api'
  const resolveUser = (body, headers = { 'Content-Type': 'application/json' }) => fetch(base + '/session/resolve', { method: 'POST', headers, body })
  try {
    const list = await fetch(base + '/users')
    assert.equal(list.status, 200)
    assert.deepEqual(await list.json(), { users: [consumer, business, admin].map(record => parseUserRecord(record).user) })

    const resolved = await resolveUser(JSON.stringify({ userId: 'user-b2b-01', role: 'ADMIN' }))
    assert.equal(resolved.status, 200)
    assert.equal(resolved.headers.get('set-cookie'), null)
    assert.deepEqual(await resolved.json(), { user: parseUserRecord(business).user })

    for (const [response, status, code] of [
      [await resolveUser(JSON.stringify({ userId: 'missing' })), 404, 'USER_NOT_FOUND'],
      [await resolveUser(JSON.stringify({ userId: 'user-off' })), 403, 'USER_DISABLED'],
      [await resolveUser(JSON.stringify({ userId: 'user-guest' })), 422, 'UNKNOWN_USER_ROLE'],
      [await resolveUser(JSON.stringify({ userId: 'user-b2b-bad' })), 422, 'INVALID_B2B_DATA'],
      [await resolveUser(JSON.stringify({ userId: 1 })), 400, 'INVALID_USER_ID'],
      [await resolveUser(JSON.stringify([])), 400, 'INVALID_USER_ID'],
      [await resolveUser('{'), 400, 'INVALID_USER_ID'],
      [await resolveUser(undefined, {}), 400, 'INVALID_USER_ID'],
      [await resolveUser(JSON.stringify({ userId: 'x'.repeat(200000) })), 413, 'INVALID_USER_ID'],
    ]) {
      assert.equal(response.status, status)
      const body = await response.json()
      assert.equal(body.error.code, code)
      assert.equal(typeof body.error.message, 'string')
    }

    const failure = async () => { throw new Error('SECRET_INTERNAL_DETAIL') }
    userService.directory = { list: failure, find: failure }
    const log = console.error
    console.error = () => {}
    try {
      for (const response of [await fetch(base + '/users'), await resolveUser(JSON.stringify({ userId: 'user-b2c-01' }))]) {
        assert.equal(response.status, 503)
        const text = await response.text()
        assert.equal(JSON.parse(text).error.code, 'USER_SERVICE_UNAVAILABLE')
        assert.ok(!text.includes('SECRET'))
      }
    } finally { console.error = log }
  } finally {
    userService.directory = original
    await new Promise(resolve => server.close(resolve))
  }
})
