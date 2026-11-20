/** Configuración, errores y lifecycle de pg con mocks. Esta suite no abre conexiones PostgreSQL. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { types } from 'pg'
import { getDatabaseConfig, getDatabaseTestConfig } from '../dist/config/database.js'
import { Database } from '../dist/db/pool.js'
import { DatabaseError, databaseError } from '../dist/db/databaseError.js'
import { withTransaction } from '../dist/db/transaction.js'

const url = 'postgresql://runtime:fake-password@db.example/commerce'
const configuration = () => getDatabaseConfig({ DATABASE_URL: url })

/** Simula el mismo client durante una transacción y permite fallos por sentencia sin IO. */
function fixture(failures = {}, commitCommand = 'COMMIT') {
  const calls = [], releases = []
  const client = {
    async query(sql, parameters) {
      calls.push([sql, parameters])
      if (failures[sql]) throw failures[sql]
      return { command: sql === 'COMMIT' ? commitCommand : sql, rows: [{ value: '99999.995' }], rowCount: 1 }
    },
    release(discard) { releases.push(discard) },
  }
  const pool = new EventEmitter()
  let ends = 0, connections = 0
  pool.connect = async () => { connections++; return client }
  pool.query = client.query
  pool.end = async () => { ends++ }
  return { client, pool, calls, releases, ends: () => ends, connections: () => connections }
}

test('importar DB y App, o cerrar DB sin usar, no abre sockets ni requiere DATABASE_URL', () => {
  const script = `import net from 'node:net';
    net.Socket.prototype.connect = function () { throw new Error('Conexión inesperada'); };
    delete process.env.DATABASE_URL;
    const {database}=await import(${JSON.stringify(new URL('../dist/db/pool.js', import.meta.url).href)});
    await import(${JSON.stringify(new URL('../dist/app.js', import.meta.url).href)});
    await database.close();`
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8' })
  assert.equal(child.status, 0, child.stderr)
})

test('configuración separa TLS de la URL, conserva verificación y decodifica credenciales sin exponerlas', () => {
  const config = configuration()
  assert.equal(config.host, 'db.example')
  assert.equal(config.max, 3)
  assert.equal(config.connectionTimeoutMillis, 5000)
  assert.equal(config.ssl.rejectUnauthorized, true)
  assert.equal(config.connectionString, undefined)
  const encoded = getDatabaseConfig({ DATABASE_URL: 'postgres://runtime:p%40ss@db.example:5433/my%20db', DATABASE_CA_CERT: 'FAKE_CA', DATABASE_POOL_MAX: '4' })
  assert.equal(encoded.password, 'p@ss')
  assert.equal(encoded.database, 'my db')
  assert.equal(encoded.port, 5433)
  assert.equal(encoded.max, 4)
  assert.equal(encoded.ssl.ca, 'FAKE_CA')
  const fromUrl = getDatabaseConfig({ DATABASE_URL: url + '?sslmode=require', DATABASE_CA_CERT: 'FAKE_CA' })
  assert.equal(fromUrl.ssl.rejectUnauthorized, true)
  assert.equal(fromUrl.ssl.ca, 'FAKE_CA')
})

for (const environment of [{}, { DATABASE_URL: 'invalid' }, { DATABASE_URL: 'https://db.example/db' },
  { DATABASE_URL: url + '?sslmode=no-verify' }, { DATABASE_URL: url + '?sslmode=disable' },
  { DATABASE_URL: url + '?sslmode=require&sslmode=disable' },
  { DATABASE_URL: url + '?sslrootcert=private-path' }, { DATABASE_URL: url, DATABASE_SSL_MODE: 'disable' },
  { DATABASE_URL: url, DATABASE_SSL_MODE: 'prefer' },
  ...['0', '-1', '1.5', 'Infinity', '2147483648', '3x', ''].map(value => ({ DATABASE_URL: url, DATABASE_POOL_MAX: value }))]) {
  test('rechaza configuración incompleta/ambigua sin copiar su contenido al error ' + JSON.stringify(Object.keys(environment)), () => {
    assert.throws(() => getDatabaseConfig(environment), error => error instanceof DatabaseError && error.kind === 'configuration' && !error.message.includes('fake-password'))
  })
}

test('TLS puede desactivarse explícitamente solo para loopback', () => {
  for (const host of ['localhost', '127.0.0.1', '[::1]']) {
    const config = getDatabaseConfig({ DATABASE_URL: `postgresql://local:fake@${host}/test`, DATABASE_SSL_MODE: 'disable' })
    assert.equal(config.ssl, false)
  }
})

test('Integration exige opt-in y URL local propia, sin fallback a runtime', () => {
  const safe = { RUN_DATABASE_INTEGRATION_TESTS: '1', DATABASE_TEST_URL: 'postgres://local:fake@127.0.0.1/test', DATABASE_SSL_MODE: 'disable' }
  assert.equal(getDatabaseTestConfig(safe).database, 'test')
  for (const environment of [{ DATABASE_URL: url }, { ...safe, RUN_DATABASE_INTEGRATION_TESTS: '0' },
    { ...safe, DATABASE_TEST_URL: undefined, DATABASE_URL: url }, { ...safe, DATABASE_TEST_URL: url },
    { ...safe, DATABASE_TEST_URL: 'postgres://local:fake@127.0.0.1.remote.example/test' }]) {
    assert.throws(() => getDatabaseTestConfig(environment), { kind: 'configuration' })
  }
})

test('Pool lazy y reutilizable, parámetros separados y close idempotente', async () => {
  const h = fixture()
  let configurations = 0, pools = 0
  const db = new Database(() => { configurations++; return configuration() }, () => { pools++; return h.pool })
  assert.equal(pools, 0)
  const parameters = Object.freeze(['private value'])
  const result = await db.query('SELECT $1', parameters)
  await db.query('SELECT 2')
  assert.equal(result.rows[0].value, '99999.995')
  assert.notEqual(h.calls[0][1], parameters)
  assert.deepEqual(h.calls[0], ['SELECT $1', ['private value']])
  assert.equal(configurations, 1)
  assert.equal(pools, 1)
  await Promise.all([db.close(), db.close()])
  assert.equal(h.ends(), 1)
  await assert.rejects(db.query('SELECT 3'), { kind: 'closed' })
  await assert.rejects(db.transaction(async () => {}), { kind: 'closed' })
  let initialized = false
  const unused = new Database(() => { initialized = true; return configuration() })
  await unused.close()
  assert.equal(initialized, false)
})

test('errores de client ocioso se capturan con un mensaje sanitizado', async t => {
  const h = fixture(), db = new Database(configuration, () => h.pool)
  const messages = []
  t.mock.method(console, 'error', message => messages.push(message))
  await db.query('SELECT 1')
  h.pool.emit('error', new Error('password=PRIVATE'))
  assert.equal(messages.length, 1)
  assert.equal(messages[0].includes('PRIVATE'), false)
  await db.close()
})

test('BEGIN, queries y COMMIT usan un único client y release una vez', async () => {
  const h = fixture(), db = new Database(configuration, () => h.pool)
  const result = await db.transaction(async client => {
    assert.equal(client, h.client)
    await client.query('SELECT $1', ['value'])
    return 42
  })
  assert.equal(result, 42)
  assert.equal(h.connections(), 1)
  assert.deepEqual(h.calls.map(call => call[0]), ['BEGIN', 'SELECT $1', 'COMMIT'])
  assert.deepEqual(h.releases, [false])
  await db.close()
})

test('fallo del callback hace ROLLBACK, conserva categoría y mantiene un client sano', async () => {
  const h = fixture()
  await assert.rejects(withTransaction(h.pool, async () => { throw Object.assign(new Error('SQL PRIVATE'), { code: '23505' }) }), error => {
    assert.equal(error.kind, 'constraint')
    assert.equal(error.outcome, 'rolled-back')
    assert.equal(error.sqlState, '23505')
    assert.equal(error.message.includes('PRIVATE'), false)
    assert.equal(error.cause, undefined)
    return true
  })
  assert.deepEqual(h.calls.map(call => call[0]), ['BEGIN', 'ROLLBACK'])
  assert.deepEqual(h.releases, [false])
})

test('ROLLBACK fallido destruye el client y conserva el error de la operación', async () => {
  const h = fixture({ ROLLBACK: new Error('connection broken') })
  await assert.rejects(withTransaction(h.pool, async () => { throw Object.assign(new Error('PRIVATE'), { code: '23514' }) }), { kind: 'constraint', outcome: 'not-committed' })
  assert.deepEqual(h.releases, [true])
})

test('fallo de BEGIN descarta el client, sin intentar COMMIT', async () => {
  const h = fixture({ BEGIN: Object.assign(new Error('PRIVATE'), { code: 'ECONNRESET' }) })
  await assert.rejects(withTransaction(h.pool, async () => assert.fail('No ejecutar callback')), { kind: 'unavailable' })
  assert.deepEqual(h.calls.map(call => call[0]), ['BEGIN'])
  assert.deepEqual(h.releases, [true])
})

test('COMMIT rechazado por constraint revierte y COMMIT sin respuesta conserva resultado incierto', async () => {
  for (const code of ['23503', 'ECONNRESET', '40003', '57P05', undefined]) {
    const h = fixture({ COMMIT: Object.assign(new Error('PRIVATE'), { code }) })
    let operations = 0
    await assert.rejects(withTransaction(h.pool, async () => { operations++; return 'result' }), {
      kind: code === '23503' ? 'constraint' : 'uncertain-commit',
      outcome: code === '23503' ? 'rolled-back' : 'unknown',
    })
    assert.equal(operations, 1)
    assert.deepEqual(h.releases, [code !== '23503'])
  }
})

test('command ROLLBACK en respuesta a COMMIT nunca se devuelve como éxito', async () => {
  const h = fixture({}, 'ROLLBACK')
  await assert.rejects(withTransaction(h.pool, async () => 42), { kind: 'transaction', outcome: 'rolled-back' })
  assert.deepEqual(h.releases, [false])
})

test('fallos de adquisición, query y shutdown se normalizan sin contenido sensible', async () => {
  const h = fixture({ QUERY: Object.assign(new Error('PRIVATE'), { code: 'ECONNRESET' }) })
  const db = new Database(configuration, () => h.pool)
  await assert.rejects(db.query('QUERY'), { kind: 'unavailable' })
  h.pool.connect = async () => { throw new Error('PASSWORD') }
  await assert.rejects(db.transaction(async () => {}), { kind: 'unavailable' })
  h.pool.end = async () => { throw new Error('PASSWORD') }
  await assert.rejects(db.close(), error => error instanceof DatabaseError && !error.message.includes('PASSWORD'))
  assert.equal(databaseError(Object.assign(new Error('PRIVATE'), { code: '42601' })).kind, 'transaction')
})

test('NUMERIC mantiene el parser string de pg y la migration no fija escala ni recalcula importes', () => {
  assert.equal(types.getTypeParser(1700)('99999.995'), '99999.995')
  const sql = readFileSync(new URL('../supabase/migrations/20261109000100_commerce_foundation.sql', import.meta.url), 'utf8')
  assert.equal((sql.match(/CREATE TABLE commerce\./g) ?? []).length, 3)
  assert.doesNotMatch(sql, /NUMERIC\s*\(|\bROUND\s*\(|\bDROP\s|\bTRUNCATE\s|CREATE\s+(FUNCTION|PROCEDURE|TRIGGER)/i)
  assert.doesNotMatch(sql, /^\s*(COMMIT|ROLLBACK|BEGIN)\s*;/im)
  assert.match(sql, /idempotency_key TEXT PRIMARY KEY/)
  assert.match(sql, /PRIMARY KEY \(order_id, idempotency_key\)/)
  assert.match(sql, /DEFERRABLE INITIALLY DEFERRED/)
})
