/** CN-69: guardas puras y regresiones con dotenv real en subprocesses sin red y con fixtures ficticios. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { assertIntegrationConnection, assertIntegrationListener, assertIntegrationModule, assertIntegrationRead,
  guardIntegrationDatabase, isolatedIntegrationEnvironment, publicDotenv, sessionIdentitySql,
  validateIntegrationEnvironment, validateSessionIdentity, verifyIntegrationDatabases, verifyIntegrationSession,
} from './helpers/postgresIntegrationHarness.mjs'

const input = () => ({ RUN_DATABASE_INTEGRATION_TESTS: '1',
  DATABASE_TEST_URL: 'postgresql://cn_test_admin:fake-admin@127.0.0.1:5432/cibernova_test',
  DATABASE_RUNTIME_TEST_URL: 'postgresql://cibernova_app:fake-runtime@127.0.0.1:5432/cibernova_test',
  CN69_POSTGRES_CONTAINER_ID: 'a'.repeat(64), CN69_POSTGRES_SERVER_ADDRESS: '172.18.0.2' })
const environment = () => isolatedIntegrationEnvironment(input())
const identity = (role = 'runtime') => ({ user_name: role === 'runtime' ? 'cibernova_app' : 'cn_test_admin',
  login_name: role === 'runtime' ? 'cibernova_app' : 'cn_test_admin', database_name: 'cibernova_test',
  version: 170011, server_address: '172.18.0.2', server_port: 5432, restricted: role === 'runtime' })
const target = { serverAddress: '172.18.0.2' }

test('acepta exclusivamente el par de URLs y el recurso efímero explícitos', () => {
  assert.deepEqual(validateIntegrationEnvironment(environment()), target)
})

for (const optIn of [undefined, '0', 'true']) test('opt-in ausente/incorrecto falla en ejecución solicitada: ' + String(optIn), () => {
  assert.throws(() => validateIntegrationEnvironment({ ...environment(), RUN_DATABASE_INTEGRATION_TESTS: optIn }), /OPT_IN_REQUIRED/)
})

test('sin opt-in permite únicamente la omisión intencional, sin URLs habilitadas', () => {
  const result = isolatedIntegrationEnvironment({ DATABASE_TEST_URL: 'private-placeholder' })
  assert.equal(result.RUN_DATABASE_INTEGRATION_TESTS, '0')
  assert.equal(result.DATABASE_TEST_URL, '')
  assert.equal(result.DATABASE_RUNTIME_TEST_URL, '')
  assert.throws(() => isolatedIntegrationEnvironment({ RUN_DATABASE_INTEGRATION_TESTS: 'true' }), /INVALID_OPT_IN/)
})

for (const [name, url] of Object.entries({
  missing: undefined, remote: 'postgresql://cn_test_admin:fake@db.example.com:5432/cibernova_test',
  localhost: 'postgresql://cn_test_admin:fake@localhost:5432/cibernova_test',
  port: 'postgresql://cn_test_admin:fake@127.0.0.1:5433/cibernova_test',
  database: 'postgresql://cn_test_admin:fake@127.0.0.1:5432/postgres',
  role: 'postgresql://postgres:fake@127.0.0.1:5432/cibernova_test',
  password: 'postgresql://cn_test_admin@127.0.0.1:5432/cibernova_test',
  ssl: 'postgresql://cn_test_admin:fake@127.0.0.1:5432/cibernova_test?sslmode=disable',
  fragment: 'postgresql://cn_test_admin:fake@127.0.0.1:5432/cibernova_test#other',
})) test('rechaza destino admin no permitido, sin revelar su valor: ' + name, () => {
  assert.throws(() => isolatedIntegrationEnvironment({ ...input(), DATABASE_TEST_URL: url }), { message: 'CN69_POSTGRES_INVALID_TARGET' })
})

for (const [name, patch] of Object.entries({
  differentResource: { DATABASE_RUNTIME_TEST_URL: 'postgresql://cibernova_app:fake@127.0.0.1:5432/other' },
  runtimeRole: { DATABASE_RUNTIME_TEST_URL: 'postgresql://cn_test_admin:fake@127.0.0.1:5432/cibernova_test' },
  missingRuntime: { DATABASE_RUNTIME_TEST_URL: undefined },
  missingContainer: { CN69_POSTGRES_CONTAINER_ID: '' },
  missingAddress: { CN69_POSTGRES_SERVER_ADDRESS: '' },
  invalidAddress: { CN69_POSTGRES_SERVER_ADDRESS: 'db.example.com' },
})) test('falla cerrado ante configuración de recurso incompleta: ' + name, () => {
  assert.throws(() => isolatedIntegrationEnvironment({ ...input(), ...patch }), /CN69_POSTGRES_/)
})

test('descarta dotenv, secretos, proxies y configuración comercial heredada antes de imports', () => {
  const result = isolatedIntegrationEnvironment({ ...input(), PATH: 'test-path',
    NODE_OPTIONS: '--require private-placeholder', PGSERVICE: 'private-placeholder', HTTP_PROXY: 'private-placeholder',
    DOTENV_CONFIG_PATH: 'private-placeholder', DATABASE_URL: 'private-placeholder', COMMERCE_STORE_MODE: 'postgresql',
    ALGOLIA_API_KEY: 'private-placeholder', ALGOLIA_ORDERS_API_KEY: 'private-placeholder',
    ALGOLIA_ORDERS_RECONCILE_ON_START: 'true' })
  assert.equal(result.PATH, 'test-path')
  for (const key of ['NODE_OPTIONS', 'PGSERVICE', 'HTTP_PROXY']) assert.equal(key in result, false)
  assert.equal(result.DOTENV_CONFIG_PATH, publicDotenv)
  assert.equal(result.DATABASE_URL, '')
  assert.equal(result.COMMERCE_STORE_MODE, 'memory')
  assert.equal(result.ALGOLIA_API_KEY, 'qa-fake-key')
  assert.equal(result.ALGOLIA_ORDERS_API_KEY, '')
  assert.equal(result.ALGOLIA_ORDERS_RECONCILE_ON_START, 'false')
})

for (const [key, value] of Object.entries({ COMMERCE_STORE_MODE: 'postgresql', DATABASE_URL: 'private-placeholder',
  ORDER_CREATION_MODE: 'v2-only', DATABASE_TEST_SSL_MODE: 'verify-full', ALGOLIA_ORDERS_INDEX_NAME: 'orders',
  ALGOLIA_ORDERS_API_KEY: 'private-placeholder', ALGOLIA_ORDERS_RECONCILE_ON_START: 'true' })) {
  test('rechaza cambios posteriores que contradigan el aislamiento: ' + key, () => {
    assert.throws(() => validateIntegrationEnvironment({ ...environment(), [key]: value }), /UNSAFE_COMPOSITION/)
  })
}

test('solo admite el ejemplo dotenv público; bloquea rutas privadas sin abrirlas', () => {
  for (const path of [publicDotenv, pathToFileURL(publicDotenv), Buffer.from(publicDotenv)]) assert.doesNotThrow(() => assertIntegrationRead(path))
  for (const path of ['.env', 'server/.env', 'server/.env.production', Buffer.from('server/.env')]) {
    assert.throws(() => assertIntegrationRead(path), /PRIVATE_ENV_BLOCKED/)
  }
  assert.doesNotThrow(() => assertIntegrationRead('server/package.json'))
})

test('red: solo PG opt-in y HTTP local previamente registrado; bloquea destinos y puertos ajenos', () => {
  const ports = new Set([41001])
  for (const args of [[5432, '127.0.0.1'], [{ host: '127.0.0.1', port: 5432 }], [[{ host: '127.0.0.1', port: 5432 }]]]) {
    assert.doesNotThrow(() => assertIntegrationConnection(args, ports, true))
    assert.throws(() => assertIntegrationConnection(args, ports, false), /NETWORK_BLOCKED/)
  }
  assert.doesNotThrow(() => assertIntegrationConnection([41001, '127.0.0.1'], ports, false))
  for (const args of [[443, 'algolia.example.com'], [5432, 'localhost'], [5432, '172.18.0.2'], [41002, '127.0.0.1'],
    [{ path: '/tmp/.s.PGSQL.5432' }], [{ host: '127.0.0.1' }]]) assert.throws(() => assertIntegrationConnection(args, ports, true), /NETWORK_BLOCKED/)
  assert.doesNotThrow(() => assertIntegrationListener([0, '127.0.0.1']))
  for (const args of [[0], [0, '0.0.0.0'], [5432, '127.0.0.1']]) assert.throws(() => assertIntegrationListener(args), /LISTENER_BLOCKED/)
})

test('bloquea entry points de Seeds y mantenimiento sin importarlos', () => {
  for (const name of ['file:///repo/server/dist/scripts/seedUsers.js', '../dist/scripts/syncOrdersIndex.js', 'server/src/scripts/seedAlgolia.ts']) {
    assert.throws(() => assertIntegrationModule(name), /MAINTENANCE_BLOCKED/)
  }
  assert.doesNotThrow(() => assertIntegrationModule('../dist/services/orderIndexSyncService.js'))
})

test('identidad real: admite PG17 y roles esperados en el servidor identificado', () => {
  for (const role of ['admin', 'runtime']) assert.doesNotThrow(() => validateSessionIdentity(identity(role), role, target))
})

for (const [name, patch] of Object.entries({ version16: { version: 160011 }, version18: { version: 180001 },
  versionString: { version: '170011' }, database: { database_name: 'postgres' }, user: { user_name: 'postgres' },
  login: { login_name: 'postgres' }, address: { server_address: '172.18.0.3' }, port: { server_port: 5433 },
  privileges: { restricted: false } })) test('rechaza sesión inesperada antes de fixtures: ' + name, () => {
  assert.throws(() => validateSessionIdentity({ ...identity(), ...patch }, 'runtime', target), /SESSION_IDENTITY/)
})

test('la consulta de identidad PG17 extrae host sin netmask para comparar la IP exacta del contenedor', () => {
  // PostgreSQL documenta que inet::text incluye /32; host(inet) devuelve solo la dirección.
  assert.match(sessionIdentitySql, /host\(inet_server_addr\(\)\) AS server_address/)
  assert.doesNotMatch(sessionIdentitySql, /inet_server_addr\(\)::text/)
  const resource = validateIntegrationEnvironment(environment())
  assert.equal(new URL(input().DATABASE_TEST_URL).hostname, '127.0.0.1')
  assert.equal(resource.serverAddress, '172.18.0.2', 'La IP Docker procede del recurso inspeccionado, no del endpoint del Runner.')
  for (const role of ['admin', 'runtime']) validateSessionIdentity(identity(role), role, resource)
})

test('la comparación de IP sigue siendo exacta y bloquea escrituras ante otro host, netmask o NULL', async () => {
  for (const server_address of ['127.0.0.1', '172.18.0.3', '172.18.0.2/32', '172.18.0.0/16', null]) {
    const db = fakeDatabase({ ...identity('admin'), server_address })
    guardIntegrationDatabase(db, 'admin', environment())
    await assert.rejects(db.query('synthetic write'), /SESSION_IDENTITY/)
    assert.equal(db.operations.some(value => Array.isArray(value) && value[0] === 'business query'), false)
    assert.deepEqual(db.operations.at(-1), ['release', false])
  }
})

test('conserva identidades iniciales administrativa/runtime y rechaza SET ROLE inesperado o tipos inválidos', () => {
  for (const role of ['admin', 'runtime']) {
    for (const patch of [{ user_name: 'commerce_runtime' }, { login_name: 'unexpected' }, { user_name: null },
      { version: null }, { server_port: '5432' }]) {
      assert.throws(() => validateSessionIdentity({ ...identity(role), ...patch }, role, target), /SESSION_IDENTITY/)
    }
  }
  for (const restricted of [null, undefined, false]) {
    assert.throws(() => validateSessionIdentity({ ...identity(), restricted }, 'runtime', target), /SESSION_IDENTITY/)
  }
})

function fakeDatabase(row = identity(), { rollbackFails = false, selectFails = false } = {}) {
  const operations = []
  const client = { async query(sql) {
    operations.push(sql)
    if (sql === 'ROLLBACK' && rollbackFails) throw new Error('fake rollback failure')
    if (sql === sessionIdentitySql && selectFails) throw new Error('fake query failure')
    return { rows: [row] }
  }, release(damaged) { operations.push(['release', damaged]) } }
  return { operations, client,
    async connect() { operations.push('connect'); return client },
    async query(sql) { operations.push(['business query', sql]); return { rows: [] } },
    async transaction(operation) { operations.push('business transaction'); return operation(client) },
  }
}

test('verificación solo READ ONLY/SELECT/ROLLBACK, con cleanup antes de operaciones comerciales', async () => {
  const db = fakeDatabase()
  await verifyIntegrationSession(() => db.connect(), 'runtime', target)
  assert.deepEqual(db.operations, ['connect', 'BEGIN READ ONLY', sessionIdentitySql, 'ROLLBACK', ['release', false]])
})

for (const [name, options, row] of [['identity', {}, { ...identity(), database_name: 'postgres' }],
  ['select', { selectFails: true }, identity()], ['rollback', { rollbackFails: true }, identity()]]) {
  test('fallo de verificación libera/descarta y bloquea escrituras: ' + name, async () => {
    const db = fakeDatabase(row, options)
    guardIntegrationDatabase(db, 'runtime', environment())
    await assert.rejects(db.query('synthetic write'))
    await assert.rejects(db.transaction(async () => {}))
    assert.equal(db.operations.filter(value => value === 'connect').length, 1, 'Sin reintentos automáticos')
    assert.equal(db.operations.some(value => Array.isArray(value) && value[0] === 'business query'), false)
    assert.equal(db.operations.includes('business transaction'), false)
    assert.deepEqual(db.operations.at(-1), ['release', Boolean(options.rollbackFails)])
  })
}

test('guardas compartidas por query/transaction/connect; conserva concurrencia y verifica Pools nuevos', async () => {
  const db = fakeDatabase(), another = fakeDatabase(identity('admin'))
  guardIntegrationDatabase(db, 'runtime', environment())
  guardIntegrationDatabase(another, 'admin', environment())
  await verifyIntegrationDatabases(another, db)
  await Promise.all([db.query('one'), db.query('two'), db.transaction(async () => 'ok')])
  const client = await db.connect(); client.release()
  assert.equal(db.operations.filter(value => value === sessionIdentitySql).length, 1)
  assert.equal(another.operations.filter(value => value === sessionIdentitySql).length, 1)
  assert.equal(db.operations.filter(value => Array.isArray(value) && value[0] === 'business query').length, 2)
  assert.ok(db.operations.indexOf('ROLLBACK') < db.operations.findIndex(value => Array.isArray(value) && value[0] === 'business query'))
})

const suites = ['database', 'commerce', 'e2e', 'orderIndex', 'adminOrders']
test('las cinco suites instalan aislamiento primero y verifican ambas sesiones antes de fixtures', () => {
  for (const suite of suites) {
    const source = readFileSync(new URL(`./${suite}.integration.test.mjs`, import.meta.url), 'utf8')
    assert.ok(source.startsWith("import './helpers/postgresIntegrationIsolation.mjs'"), suite)
    assert.match(source, /guardIntegrationDatabase/)
    assert.match(source, /await verifyIntegrationDatabases\(/)
  }
})

test('Workflow conserva cinco suites, cuatro Migrations ordenadas, serialización y rechazo de omisiones', () => {
  const source = readFileSync(new URL('../../.github/workflows/server-postgresql-ci.yml', import.meta.url), 'utf8')
  assert.match(source, /node --test --test-concurrency=1 --test-reporter=tap/)
  for (const suite of suites) assert.equal(source.split(`tests/${suite}.integration.test.mjs`).length, 2)
  assert.match(source, /for counter in fail cancelled skipped todo/)
  assert.match(source, /image: postgres:17/)
  assert.match(source, /node-version: '24'/)
  assert.match(source, /contents: read/)
  assert.match(source, /job\.services\.postgres\.id/)
  assert.match(source, /verified_fresh_resource/)
  assert.match(source, /env -i PATH=/)
  const migrations = ['20261109000100_commerce_foundation.sql', '20261110025043_cibernova_runtime_login.sql',
    '20261117000100_order_creation_v2.sql', '20261118000100_order_search_index.sql']
  let previous = -1
  for (const migration of migrations) {
    const index = source.indexOf('--file supabase/migrations/' + migration)
    assert.ok(index > previous); previous = index
    assert.equal(source.split('--file supabase/migrations/' + migration).length, 2)
  }
})

/** Proceso nuevo para no contaminar process.env, el cache ESM ni las guardas de los demás Unit Tests. */
function runRealDotenv(t, body, inherited = 'true') {
  const directory = mkdtempSync(join(tmpdir(), 'cn69-dotenv-'))
  t.after(() => {
    // El único target recursivo es el directorio temporal propio, identificado antes de borrarlo.
    assert.equal(dirname(directory), resolve(tmpdir()))
    assert.match(basename(directory), /^cn69-dotenv-/)
    rmSync(directory, { recursive: true, force: true })
  })
  const fixture = join(directory, 'dotenv.fixture')
  const privatePath = join(directory, '.env.private-never-created')
  writeFileSync(fixture, `RUN_DATABASE_INTEGRATION_TESTS=0
DATABASE_TEST_URL=postgresql://fake:fake@192.0.2.1:5432/forbidden
DATABASE_RUNTIME_TEST_URL=postgresql://fake:fake@192.0.2.1:5432/forbidden
COMMERCE_STORE_MODE=postgresql
DATABASE_URL=postgresql://fake:fake@192.0.2.1:5432/forbidden
DATABASE_TEST_SSL_MODE=verify-full
ORDER_CREATION_MODE=v2-only
ALGOLIA_APP_ID=UNEXPECTED_FAKE_APP
ALGOLIA_API_KEY=unexpected-fake-key
ALGOLIA_INDEX_NAME=unexpected_products
ALGOLIA_USERS_INDEX_NAME=unexpected_users
ALGOLIA_ORDERS_INDEX_NAME=orders
ALGOLIA_ORDERS_API_KEY=unexpected-fake-orders-key
ALGOLIA_ORDERS_RECONCILE_ON_START=true
`)
  const environment = { ...input(), DOTENV_CONFIG_OVERRIDE: inherited, DOTENV_CONFIG_DEBUG: inherited,
    DOTENV_CONFIG_PATH: privatePath, DATABASE_URL: 'fake-inherited-value', COMMERCE_STORE_MODE: 'postgresql',
    CN65_CLI_EXPECTED_DOTENV: publicDotenv, CN65_CLI_FIXTURE_DOTENV: fixture }
  for (const key of ['PATH', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'COMSPEC', 'PATHEXT']) {
    if (process.env[key] !== undefined) environment[key] = process.env[key]
  }
  const dotenv = pathToFileURL(createRequire(import.meta.url).resolve('dotenv/config')).href
  const source = `import assert from 'node:assert/strict';
    const {validateIntegrationEnvironment, publicDotenv} = await import(${JSON.stringify(new URL('./helpers/postgresIntegrationHarness.mjs', import.meta.url).href)});
    validateIntegrationEnvironment(process.env);
    assert.equal(process.env.DOTENV_CONFIG_PATH, publicDotenv);
    const keys = ['RUN_DATABASE_INTEGRATION_TESTS','DATABASE_TEST_URL','DATABASE_RUNTIME_TEST_URL',
      'COMMERCE_STORE_MODE','DATABASE_URL','DATABASE_TEST_SSL_MODE','ORDER_CREATION_MODE',
      'ALGOLIA_APP_ID','ALGOLIA_API_KEY','ALGOLIA_INDEX_NAME','ALGOLIA_USERS_INDEX_NAME',
      'ALGOLIA_ORDERS_INDEX_NAME','ALGOLIA_ORDERS_API_KEY','ALGOLIA_ORDERS_RECONCILE_ON_START'];
    const before = Object.fromEntries(keys.map(key => [key, process.env[key]]));
    await import(${JSON.stringify(dotenv)});
    assert.deepEqual(Object.fromEntries(keys.map(key => [key, process.env[key]])), before);
    assert.equal(Object.hasOwn(process.env, 'DOTENV_CONFIG_OVERRIDE'), false);
    assert.equal(Object.hasOwn(process.env, 'DOTENV_CONFIG_DEBUG'), false);
    validateIntegrationEnvironment(process.env);
    ${body.replaceAll('__PRIVATE_PATH__', JSON.stringify(privatePath))}`
  // CN-65 bloquea TODOS los sockets (también loopback PG) y sustituye exclusivamente la ruta pública por el fixture.
  // Se instala antes del aislamiento CN-69 y antes de dotenv. No se hereda NODE_OPTIONS ni configuración privada.
  return spawnSync(process.execPath, ['--import', new URL('./helpers/orderIndexCliIsolation.mjs', import.meta.url).href,
    '--import', new URL('./helpers/postgresIntegrationIsolation.mjs', import.meta.url).href,
    '--input-type=module', '--eval', source], { env: environment, encoding: 'utf8', timeout: 10000 })
}

function assertDotenvAudit(result) {
  assert.equal(result.error, undefined)
  const match = result.stderr.match(/CN65_CLI_AUDIT (\{[^\r\n]+\})/)
  assert.ok(match, 'El subprocess debe reportar el aislamiento instalado antes de dotenv.')
  assert.deepEqual(JSON.parse(match[1]), { environmentReads: 1, unexpectedEnvironmentReads: 0, networkAttempts: 0 })
}

for (const inherited of ['true', 'false']) test('dotenv/config real preserva el entorno y neutraliza override/debug heredados: ' + inherited, t => {
  const result = runRealDotenv(t, `console.log('CN69_REAL_DOTENV_PASS')`, inherited)
  assertDotenvAudit(result)
  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.stdout.trim(), 'CN69_REAL_DOTENV_PASS', 'No debe aparecer debug ni configuración.')
  assert.match(result.stderr, /CN69_POSTGRES_ISOLATION violations=0/)
})

test('después de dotenv real un destino incompatible termina FAIL sin conectar ni revelar la URL', t => {
  const result = runRealDotenv(t, `process.env.DATABASE_RUNTIME_TEST_URL='postgresql://fake:fake@192.0.2.2:5432/forbidden';
    validateIntegrationEnvironment(process.env);`)
  assertDotenvAudit(result)
  assert.equal(result.status, 1)
  assert.equal(result.stdout, '')
  assert.match(result.stderr, /CN69_POSTGRES_INVALID_TARGET/)
  assert.doesNotMatch(result.stderr, /postgresql:\/\//)
})

test('después de dotenv real las violaciones capturadas de red, Seeds, subprocesses y dotenv privado causan FAIL', t => {
  const result = runRealDotenv(t, `const {default: net}=await import('node:net');
    const {default: fs}=await import('node:fs');
    const {default: childProcess}=await import('node:child_process');
    assert.throws(()=>new net.Socket().connect(5432,'127.0.0.2'), /NETWORK_BLOCKED/);
    assert.throws(()=>new net.Socket().connect(443,'algolia.example.invalid'), /NETWORK_BLOCKED/);
    assert.throws(()=>fs.readFileSync(__PRIVATE_PATH__), /PRIVATE_ENV_BLOCKED/);
    assert.throws(()=>childProcess.spawn('CN69_NONEXISTENT_PROGRAM',[]), /EXTERNAL_OPERATION_BLOCKED/);
    await assert.rejects(import(${JSON.stringify(new URL('../dist/scripts/seedUsers.js', import.meta.url).href)}), /MAINTENANCE_BLOCKED/);
    console.log('CN69_CAUGHT_VIOLATIONS_PASS');`)
  assertDotenvAudit(result)
  assert.equal(result.status, 1, 'Las excepciones capturadas no pueden producir éxito.')
  assert.equal(result.stdout.trim(), 'CN69_CAUGHT_VIOLATIONS_PASS')
  assert.match(result.stderr, /CN69_POSTGRES_ISOLATION violations=5/)
})
