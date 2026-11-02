/** Contrato HTTP de identidad: respuestas desconocidas, proyección pública y errores de CN-52. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { fileURLToPath } from 'node:url'

const source = readFileSync(new URL('../src/services/sessionApi.ts', import.meta.url), 'utf8').replace('import.meta.env.VITE_API_BASE_URL', 'undefined')
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ESNext } }).outputText
const { sessionApi, SessionApiError, sessionErrorMessage } = await import('data:text/javascript;base64,' + Buffer.from(compiled).toString('base64'))
const profiles = [
  { id: 'c', displayName: 'Cliente', role: 'B2C' },
  { id: 'b', displayName: 'Empresa', role: 'B2B', company: { id: 'co', name: 'Empresa Demo' } },
  { id: 'a', displayName: 'Administrador', role: 'ADMIN' },
]

test('lista y resuelve los tres roles con payload mínimo y sin campos internos', async t => {
  const requests = []
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    requests.push([url, options])
    return Response.json(options.method === 'GET'
      ? { users: profiles.map(user => ({ ...user, enabled: true, _highlightResult: {} })) }
      : { user: { ...profiles.find(user => user.id === JSON.parse(options.body).userId), enabled: true } })
  })
  assert.deepEqual(await sessionApi.listUsers(new AbortController().signal), profiles)
  for (const user of profiles) assert.deepEqual(await sessionApi.resolveUser(user.id, new AbortController().signal), user)
  assert.equal(requests[0][0], '/api/users')
  for (const [url, options] of requests.slice(1)) {
    assert.equal(url, '/api/session/resolve')
    assert.deepEqual(Object.keys(JSON.parse(options.body)), ['userId'])
    assert.equal(options.headers['X-CiberNova-User-Id'], undefined)
    assert.ok(options.signal instanceof AbortSignal)
  }
})

test('rechaza JSON, roles, Company, IDs inesperados y directorios inválidos', async t => {
  let body
  t.mock.method(globalThis, 'fetch', async () => Response.json(body))
  for (const user of [null, {}, { ...profiles[0], id: '' }, { ...profiles[0], role: 'GUEST' },
    { ...profiles[0], company: profiles[1].company }, { ...profiles[2], company: null },
    { ...profiles[1], company: undefined }, { ...profiles[1], company: { id: 'co' } },
    { ...profiles[0], id: 'another' }]) {
    body = { user }
    await assert.rejects(sessionApi.resolveUser('c', new AbortController().signal), SessionApiError)
  }
  for (const value of [{}, { users: null }, { users: [profiles[0], profiles[0]] }, { users: [{ ...profiles[0], role: 'GUEST' }] }]) {
    body = value
    await assert.rejects(sessionApi.listUsers(new AbortController().signal), SessionApiError)
  }
  body = { users: [] }
  assert.deepEqual(await sessionApi.listUsers(new AbortController().signal), [])
  t.mock.method(globalThis, 'fetch', async () => new Response('invalid-json', { status: 200 }))
  await assert.rejects(sessionApi.resolveUser('c', new AbortController().signal), SessionApiError)
})

test('conserva códigos 400/403/404/413/422/503 sin mostrar mensajes internos', async t => {
  let status, code
  t.mock.method(globalThis, 'fetch', async () => Response.json({ error: { code, message: 'INTERNAL_DETAIL' } }, { status }))
  for ([status, code] of [[400, 'INVALID_USER_ID'], [403, 'USER_DISABLED'], [404, 'USER_NOT_FOUND'],
    [413, 'INVALID_USER_ID'], [422, 'INVALID_B2B_DATA'], [422, 'UNKNOWN_USER_ROLE'], [503, 'USER_SERVICE_UNAVAILABLE'], [500, 'UNEXPECTED_ERROR']]) {
    await assert.rejects(sessionApi.resolveUser('c', new AbortController().signal), error => {
      assert.equal(error.code, code)
      assert.ok(!sessionErrorMessage(error).includes('INTERNAL'))
      return true
    })
  }
})

test('un error de red o una cancelación no produce una identidad', async t => {
  t.mock.method(globalThis, 'fetch', async (_url, options) => { options.signal.throwIfAborted(); throw new TypeError('network') })
  await assert.rejects(sessionApi.resolveUser('c', new AbortController().signal), TypeError)
  const abort = new AbortController()
  abort.abort()
  await assert.rejects(sessionApi.resolveUser('c', abort.signal), { name: 'AbortError' })
})

test('los módulos nuevos de Session compilan con strict y noEmit sin cambiar tsconfig', () => {
  const root = fileURLToPath(new URL('../', import.meta.url))
  const config = ts.readConfigFile(root + 'tsconfig.app.json', ts.sys.readFile)
  assert.equal(config.error, undefined)
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root)
  const files = ['context/SessionContext.ts', 'context/SessionProvider.tsx', 'hooks/useSession.ts',
    'services/sessionApi.ts', 'components/session/LoginDialog.tsx'].map(file => root + 'src/' + file)
  const options = { ...parsed.options, strict: true, noEmit: true, incremental: false, tsBuildInfoFile: undefined }
  const diagnostics = ts.getPreEmitDiagnostics(ts.createProgram(files, options))
  assert.equal(diagnostics.length, 0, ts.formatDiagnosticsWithColorAndContext(diagnostics, {
    getCanonicalFileName: file => file, getCurrentDirectory: () => root, getNewLine: () => '\n',
  }))
})
