/** Dobles de Pool exclusivamente. Nunca ejecuta el entry point CLI, dotenv ni una conexión real. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { Database } from '../dist/db/pool.js'
import { DatabaseError } from '../dist/db/databaseError.js'
import { getSmokeTestConfig, runDatabaseSmokeTest } from '../dist/scripts/databaseSmokeTest.js'

const begin = 'BEGIN READ ONLY'
const context = "SELECT current_user, current_database(), current_setting('transaction_read_only') AS transaction_read_only"
const access = 'SELECT 1 AS access_ok FROM commerce.orders LIMIT 1'
const environment = { DATABASE_URL: 'postgresql://cibernova_app.fake:fake@pooler.example:5432/postgres', DATABASE_CA_CERT: 'FAKE_PEM' }

/** Simula fallos de adquisición, sentencias, release o end para comprobar que el cleanup no se omite. */
function fixture({ rows = [{ current_user: 'cibernova_app', current_database: 'postgres', transaction_read_only: 'on' }], fail = {}, accessRows = [], clientError } = {}) {
  const queries = [], releases = []
  let connections = 0, closes = 0
  const client = Object.assign(new EventEmitter(), {
    async query(sql) {
      queries.push(sql)
      if (fail[sql]) throw fail[sql]
      if (clientError && sql === context) client.emit('error', clientError)
      return { rows: sql === context ? rows : sql === access ? accessRows : [], command: sql, rowCount: 0 }
    },
    release(discard) { releases.push(discard); if (fail.release) throw fail.release },
  })
  const pool = new EventEmitter()
  pool.connect = async () => { connections++; if (fail.connect) throw fail.connect; return client }
  pool.end = async () => { closes++; if (fail.close) throw fail.close }
  const db = new Database(() => getSmokeTestConfig(environment), () => pool)
  return { db, client, queries, releases, connections: () => connections, closes: () => closes }
}

test('configuración del chequeo reutiliza TLS/CA y limita el Pool a un client', () => {
  const config = getSmokeTestConfig({ ...environment, DATABASE_POOL_MAX: '8' })
  assert.equal(config.max, 1)
  assert.equal(config.ssl.rejectUnauthorized, true)
  assert.equal(config.ssl.ca, 'FAKE_PEM')
  assert.equal(config.connectionString, undefined)
  assert.throws(() => getSmokeTestConfig({ DATABASE_URL: 'postgres://local:fake@127.0.0.1/test', DATABASE_SSL_MODE: 'disable' }), { kind: 'configuration' })
})

for (const accessRows of [[], [{ access_ok: 1 }]]) {
  test('secuencia READ ONLY con un client y cleanup, tabla vacía o con filas: ' + accessRows.length, async () => {
    const h = fixture({ accessRows })
    assert.equal(h.connections(), 0)
    await runDatabaseSmokeTest(h.db)
    assert.deepEqual(h.queries, [begin, context, access, 'ROLLBACK'])
    assert.equal(h.connections(), 1)
    assert.deepEqual(h.releases, [false])
    assert.equal(h.closes(), 1)
    await assert.rejects(h.db.connect(), { kind: 'closed' })
  })
}

for (const rows of [[], [{ current_user: 'postgres', transaction_read_only: 'on' }],
  [{ current_user: 'cibernova_app', transaction_read_only: 'off' }]]) {
  test('contexto inesperado impide consultar Orders y libera la conexión: ' + JSON.stringify(rows), async () => {
    const h = fixture({ rows })
    await assert.rejects(runDatabaseSmokeTest(h.db), { kind: 'configuration' })
    assert.deepEqual(h.queries, [begin, context, 'ROLLBACK'])
    assert.deepEqual(h.releases, [false])
    assert.equal(h.closes(), 1)
  })
}

for (const stage of ['connect', begin, context, access, 'ROLLBACK', 'release', 'close']) {
  test('fallo en ' + stage + ' conserva error sanitizado y cierra sin reintentar', async () => {
    const raw = Object.assign(new Error('PRIVATE_PASSWORD DSN CERTIFICATE'), { code: 'ECONNRESET' })
    const h = fixture({ fail: { [stage]: raw } })
    await assert.rejects(runDatabaseSmokeTest(h.db), error => {
      assert.ok(error instanceof DatabaseError)
      assert.doesNotMatch(JSON.stringify(error) + error.message, /PRIVATE_PASSWORD|DSN|CERTIFICATE/)
      assert.equal(error.cause, undefined)
      return true
    })
    assert.equal(h.connections(), 1)
    assert.equal(new Set(h.queries).size, h.queries.length)
    assert.equal(h.closes(), 1)
    assert.equal(h.releases.length, stage === 'connect' ? 0 : 1)
    if ([begin, context, access, 'ROLLBACK'].includes(stage)) assert.deepEqual(h.releases, [true])
  })
}

test('ROLLBACK fallido descarta el client sin ocultar el rechazo SQL original', async () => {
  const h = fixture({ fail: { [access]: { code: '42501', message: 'PRIVATE' }, ROLLBACK: new Error('PRIVATE') } })
  await assert.rejects(runDatabaseSmokeTest(h.db), { kind: 'transaction', sqlState: '42501' })
  assert.deepEqual(h.releases, [true])
  assert.equal(h.closes(), 1)
})

test('error asíncrono del client se captura, descarta y retira el listener al liberar', async () => {
  const h = fixture({ clientError: Object.assign(new Error('PRIVATE'), { code: 'ECONNRESET' }) })
  await assert.rejects(runDatabaseSmokeTest(h.db), { kind: 'unavailable' })
  assert.deepEqual(h.queries, [begin, context, 'ROLLBACK'])
  assert.deepEqual(h.releases, [true])
  assert.equal(h.client.listenerCount('error'), 0)
  assert.equal(h.closes(), 1)
})
