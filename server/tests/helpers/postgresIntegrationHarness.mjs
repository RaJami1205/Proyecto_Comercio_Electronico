/**
 * CN-69 TEST-ONLY: políticas puras y guardas de sesión para el PostgreSQL efímero de CI.
 * Importar el módulo no carga dotenv ni abre conexiones; el Workflow acredita el contenedor y aplica las migrations.
 */
import { isIPv4 } from 'node:net'
import { fileURLToPath } from 'node:url'
import { basename, resolve } from 'node:path'

export const publicDotenv = fileURLToPath(new URL('../../.env.database.example', import.meta.url))
const failure = reason => new Error('CN69_POSTGRES_' + reason)

/**
 * Exige opt-in, endpoints de loopback, base/roles exactos e ID/IP del recurso declarado por el Job.
 * La IP interna identifica el servidor esperado; nunca sustituye el endpoint del Runner en las URLs.
 * La validación de sesión posterior acredita el destino real. Los errores omiten valores que puedan contener secretos.
 */
export function validateIntegrationEnvironment(environment) {
  if (environment.RUN_DATABASE_INTEGRATION_TESTS !== '1') throw failure('OPT_IN_REQUIRED')
  const urls = []
  for (const [key, user] of [['DATABASE_TEST_URL', 'cn_test_admin'], ['DATABASE_RUNTIME_TEST_URL', 'cibernova_app']]) {
    let url
    try { url = new URL(environment[key]) } catch { throw failure('INVALID_TARGET') }
    if (!['postgres:', 'postgresql:'].includes(url.protocol) || url.hostname !== '127.0.0.1'
      || url.port !== '5432' || url.pathname !== '/cibernova_test' || url.username !== user
      || !url.password || url.search || url.hash) throw failure('INVALID_TARGET')
    urls.push(url)
  }
  if (urls[0].host !== urls[1].host || urls[0].pathname !== urls[1].pathname) throw failure('TARGET_MISMATCH')
  if (!/^[a-f0-9]{64}$/.test(environment.CN69_POSTGRES_CONTAINER_ID ?? '')
    || !isIPv4(environment.CN69_POSTGRES_SERVER_ADDRESS ?? '')) throw failure('RESOURCE_REQUIRED')
  if (environment.COMMERCE_STORE_MODE !== 'memory' || environment.DATABASE_URL !== ''
    || environment.ORDER_CREATION_MODE !== 'v1-compatible' || environment.DATABASE_TEST_SSL_MODE !== 'disable'
    || environment.ALGOLIA_ORDERS_RECONCILE_ON_START !== 'false'
    || environment.ALGOLIA_ORDERS_INDEX_NAME !== '' || environment.ALGOLIA_ORDERS_API_KEY !== '') {
    throw failure('UNSAFE_COMPOSITION')
  }
  return { serverAddress: environment.CN69_POSTGRES_SERVER_ADDRESS }
}

/**
 * Construye un entorno por lista positiva: solo conserva opciones del sistema y las referencias explícitas de tests.
 * Sin opt-in vacía las URLs; la composición global permanece In-Memory y PostgreSQL se inyecta por instancia.
 * El único dotenv permitido es el ejemplo público; se omiten override/debug, no se les asigna la cadena 'false'.
 */
export function isolatedIntegrationEnvironment(input) {
  const environment = {}
  for (const key of ['PATH', 'Path', 'SystemRoot', 'SYSTEMROOT', 'WINDIR', 'TEMP', 'TMP', 'COMSPEC', 'PATHEXT', 'NODE_TEST_CONTEXT']) {
    if (input[key] !== undefined) environment[key] = input[key]
  }
  const optIn = input.RUN_DATABASE_INTEGRATION_TESTS
  if (optIn !== undefined && optIn !== '0' && optIn !== '1') throw failure('INVALID_OPT_IN')
  Object.assign(environment, {
    // dotenv/config convierte opciones presentes con Boolean(...): incluso 'false' activaría override/debug.
    DOTENV_CONFIG_PATH: publicDotenv, DOTENV_CONFIG_QUIET: 'true',
    DOTENV_CONFIG_ENCODING: 'utf8', DOTENV_KEY: '', DOTENV_CONFIG_DOTENV_KEY: '',
    COMMERCE_STORE_MODE: 'memory', ORDER_CREATION_MODE: 'v1-compatible', DATABASE_URL: '',
    DATABASE_SSL_MODE: 'disable', DATABASE_TEST_SSL_MODE: 'disable',
    RUN_DATABASE_INTEGRATION_TESTS: optIn === '1' ? '1' : '0',
    DATABASE_TEST_URL: optIn === '1' ? input.DATABASE_TEST_URL : '',
    DATABASE_RUNTIME_TEST_URL: optIn === '1' ? input.DATABASE_RUNTIME_TEST_URL : '',
    CN69_POSTGRES_CONTAINER_ID: input.CN69_POSTGRES_CONTAINER_ID ?? '',
    CN69_POSTGRES_SERVER_ADDRESS: input.CN69_POSTGRES_SERVER_ADDRESS ?? '',
    ALGOLIA_APP_ID: 'QA_FAKE_APP', ALGOLIA_API_KEY: 'qa-fake-key',
    ALGOLIA_INDEX_NAME: 'qa_products', ALGOLIA_USERS_INDEX_NAME: 'qa_users',
    ALGOLIA_ORDERS_INDEX_NAME: '', ALGOLIA_ORDERS_API_KEY: '', ALGOLIA_ORDERS_SETTINGS_API_KEY: '',
    ALGOLIA_ORDERS_RECONCILE_ON_START: 'false', ALGOLIA_SEED_API_KEY: '',
    CLIENT_ORIGIN: 'http://localhost:5173', PORT: '3001',
  })
  if (optIn === '1') validateIntegrationEnvironment(environment)
  return environment
}

/** Rechaza rutas dotenv privadas antes de abrirlas; admite el ejemplo público y lecturas ordinarias del código. */
export function assertIntegrationRead(file) {
  const path = file instanceof URL ? fileURLToPath(file)
    : typeof file === 'string' || Buffer.isBuffer(file) ? resolve(String(file)) : undefined
  if (path && /^\.env(?:\.|$)/i.test(basename(path)) && path !== publicDotenv) throw failure('PRIVATE_ENV_BLOCKED')
}

/** Solo el PG aprobado y los puertos HTTP registrados por el propio harness. Nunca DNS/IPC/TLS. */
export function assertIntegrationConnection(args, httpPorts, enabled) {
  const first = Array.isArray(args[0]) ? args[0][0] : args[0]
  const options = typeof first === 'object' && first !== null ? first : { port: first, host: args[1] }
  if (options.path || options.host !== '127.0.0.1' || !Number.isInteger(Number(options.port))
    || !(enabled && Number(options.port) === 5432 || httpPorts.has(Number(options.port)))) {
    throw failure('NETWORK_BLOCKED')
  }
}

/** Solo permite listeners HTTP de loopback con puerto asignado por el sistema; el caller registra el puerto resultante. */
export function assertIntegrationListener(args) {
  if (args[0] !== 0 || args[1] !== '127.0.0.1') throw failure('LISTENER_BLOCKED')
}

/** Impide cargar entry points de Seeds/mantenimiento, incluso mediante imports que terminen en dist. */
export function assertIntegrationModule(specifier) {
  if (/(?:src|dist)[/\\]scripts[/\\]/i.test(specifier)) throw failure('MAINTENANCE_BLOCKED')
}

// inet::text añade la máscara (/32 en IPv4); host() permite comparar la IP exacta de docker inspect.
export const sessionIdentitySql = `SELECT current_user AS user_name, session_user AS login_name,
  current_database() AS database_name, current_setting('server_version_num')::integer AS version,
  host(inet_server_addr()) AS server_address, inet_server_port() AS server_port,
  NOT (rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls) AS restricted
  FROM pg_roles WHERE rolname = current_user`

/**
 * Compara login y rol efectivo, base, versión PG17, IP interna y puerto con el recurso esperado.
 * Runtime debe carecer de privilegios globales; los permisos de tablas se comprueban en las suites de integración.
 */
export function validateSessionIdentity(row, role, target) {
  const user = role === 'admin' ? 'cn_test_admin' : role === 'runtime' ? 'cibernova_app' : undefined
  if (!user || !row || row.user_name !== user || row.login_name !== user || row.database_name !== 'cibernova_test'
    || !Number.isInteger(row.version) || row.version < 170000 || row.version >= 180000
    || row.server_address !== target.serverAddress || row.server_port !== 5432
    || (role === 'runtime' && row.restricted !== true)) throw failure('SESSION_IDENTITY')
}

/** Usa solo READ ONLY/SELECT/ROLLBACK, libera el client y descarta conexiones dañadas. Sin reintentos. */
export async function verifyIntegrationSession(connect, role, target) {
  const client = await connect()
  let damaged = false
  try {
    await client.query('BEGIN READ ONLY')
    const result = await client.query(sessionIdentitySql)
    if (result.rows.length !== 1) throw failure('SESSION_IDENTITY')
    validateSessionIdentity(result.rows[0], role, target)
  } finally {
    try { await client.query('ROLLBACK') } catch { damaged = true }
    client.release(damaged)
  }
  if (damaged) throw failure('SESSION_CLEANUP')
}

/**
 * Protege connect/query/transaction de una instancia Database con una única verificación lazy compartida.
 * Un fallo queda memorizado y bloquea operaciones posteriores sin reintentos; cada Pool reconstruido recibe su propia guarda.
 */
export function guardIntegrationDatabase(database, role, environment = process.env) {
  const target = validateIntegrationEnvironment(environment)
  const connect = database.connect.bind(database)
  const query = database.query.bind(database)
  const transaction = database.transaction.bind(database)
  let verification
  const ready = () => verification ??= verifyIntegrationSession(connect, role, target)
  database.connect = async (...args) => { await ready(); return connect(...args) }
  database.query = async (...args) => { await ready(); return query(...args) }
  database.transaction = async (...args) => { await ready(); return transaction(...args) }
  return database
}

/** Verifica ambas identidades antes de fixtures; las nuevas conexiones conservan además su guarda lazy. */
export async function verifyIntegrationDatabases(...databases) {
  for (const database of databases) {
    const client = await database.connect()
    client.release()
  }
}
