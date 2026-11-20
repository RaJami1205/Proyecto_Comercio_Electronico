/** CN-69 TEST-ONLY: capacidad limitada a un entry point fijo, sin flags/configuración heredados. */
import { isolatedIntegrationEnvironment, validateIntegrationEnvironment } from './postgresIntegrationHarness.mjs'

/** Valida el UUID/entorno efímero y excluye execArgv y NODE_TEST_CONTEXT heredados antes de crear un proceso normal. */
export function serverProcessOptions(run, input) {
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(run)) {
    throw new Error('CN69_POSTGRES_SERVER_RUN')
  }
  const env = isolatedIntegrationEnvironment(input)
  validateIntegrationEnvironment(env)
  delete env.NODE_TEST_CONTEXT
  return { env, execArgv: [], stdio: ['ignore', 'ignore', 'inherit', 'ipc'] }
}

/**
 * Gestiona ready, contadores y cierre de un hijo ya lanzado. Solo ready con PID/composición verificados autoriza HTTP.
 * Un anuncio tardío no habilita puertos y solo exit acredita la terminación de un proceso que llegó a arrancar.
 * Los errores y cierres forzados se propagan al Test; ninguna espera ni contador acredita por sí solo durabilidad.
 */
export function manageServerProcess(child, httpPorts, timeout = 15000) {
  let port, settled = false, stopping, processError = false, readyState = 'pending'
  let resolveReady, rejectReady
  const ready = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject })
  const failReady = code => {
    if (readyState !== 'pending') return
    readyState = 'failed'
    clearTimeout(timer)
    rejectReady(new Error('CN69_POSTGRES_SERVER_' + code))
  }
  const timer = setTimeout(() => failReady('READY_TIMEOUT'), timeout)
  const exited = new Promise(resolve => {
    const finish = (code, signal) => {
      if (settled) return
      settled = true
      httpPorts.delete(port)
      clearTimeout(timer)
      failReady('EARLY_EXIT')
      resolve({ code, signal })
    }
    child.once('error', () => {
      processError = true
      failReady('START')
      // Un error IPC no demuestra que un proceso que sí arrancó haya terminado.
      if (child.pid === undefined) finish(1, null)
    })
    child.once('exit', finish)
  })
  child.on('message', message => {
    if (message?.type !== 'cn69-server-ready') return
    if (readyState !== 'pending') return
    if (message.pid !== child.pid || message.storage !== 'postgresql'
      || message.verified !== true || !Number.isInteger(message.port) || message.port < 1
      || message.port > 65535 || message.port === 5432) {
      failReady('IDENTITY')
      return
    }
    port = message.port
    httpPorts.add(port)
    readyState = 'ready'
    clearTimeout(timer)
    resolveReady({ pid: child.pid, base: 'http://127.0.0.1:' + port, storage: 'postgresql' })
  })
  const boundedExit = () => new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('CN69_POSTGRES_SERVER_STOP_TIMEOUT')), timeout)
    exited.then(value => { clearTimeout(timer); resolve(value) })
  })
  return {
    ready,
    get terminated() { return settled },
    /** Lee contadores del hijo por IPC sin IO comercial; un timeout, salida o respuesta inválida rechaza la consulta. */
    counts() {
      return new Promise((resolve, reject) => {
        const finish = (error, value) => { clearTimeout(timer); child.off('message', receive); child.off('exit', exit); error ? reject(error) : resolve(value) }
        const exit = () => finish(new Error('CN69_POSTGRES_SERVER_COUNTS_EXIT'))
        const receive = message => {
          if (message?.type !== 'cn69-server-counts') return
          if (!Number.isSafeInteger(message.catalog) || message.catalog < 0 || !Number.isSafeInteger(message.payments) || message.payments < 0) return finish(new Error('CN69_POSTGRES_SERVER_COUNTS'))
          finish(undefined, { catalog: message.catalog, payments: message.payments })
        }
        const timer = setTimeout(() => finish(new Error('CN69_POSTGRES_SERVER_COUNTS_TIMEOUT')), timeout)
        child.on('message', receive); child.once('exit', exit)
        if (settled || !child.connected) return exit()
        child.send('cn69-server-counts', error => { if (error) finish(new Error('CN69_POSTGRES_SERVER_COUNTS')) })
      })
    },
    /** Solicita cleanup por IPC y espera exit; SIGKILL es un último recurso acotado que hace fallar el cierre. */
    stop() {
      stopping ??= (async () => {
        clearTimeout(timer)
        failReady('STOPPED')
        if (!settled && child.connected) child.send('cn69-server-stop', error => {
          if (error) child.kill('SIGKILL')
        })
        let result
        try { result = await boundedExit() }
        catch (error) { child.kill('SIGKILL'); await boundedExit(); throw error }
        if (processError || result.code !== 0 || result.signal !== null) throw new Error('CN69_POSTGRES_SERVER_CLEANUP')
      })()
      return stopping
    },
  }
}
