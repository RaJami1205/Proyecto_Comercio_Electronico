import { readFileSync } from 'node:fs'
import ts from 'typescript'

export const dataUrl = source => 'data:text/javascript;base64,' + Buffer.from(source).toString('base64')
let instance = 0
export async function loadAnalytics() {
  const source = readFileSync(new URL('../../src/services/analytics.ts', import.meta.url), 'utf8')
  const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ESNext } }).outputText
  const url = dataUrl(js) + '#instance-' + instance++
  return { api: await import(url), url }
}

/** Dos módulos representan pestañas con cachés independientes y storage/locks compartidos. */
export function analyticsEnvironment(t, { locks = true } = {}) {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
  const previousNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
  const stored = new Map(), queues = new Map(), listeners = new Set()
  const storage = {
    getItem: key => stored.get(key) ?? null,
    setItem: (key, value) => stored.set(key, value),
  }
  const manager = { request(name, callback) {
    const job = (queues.get(name) ?? Promise.resolve()).then(callback)
    queues.set(name, job.catch(() => {}))
    return job
  } }
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {
    localStorage: storage,
    dispatchEvent: event => { listeners.forEach(listener => listener(event)); return true },
  } })
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: locks ? { locks: manager } : {} })
  t.after(() => {
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow)
    else delete globalThis.window
    if (previousNavigator) Object.defineProperty(globalThis, 'navigator', previousNavigator)
    else delete globalThis.navigator
  })
  return { stored, storage, listeners }
}

export const event = (type, metadata = {}) => ({ type, occurredAt: '2026-11-06T12:00:00.000Z', metadata })
