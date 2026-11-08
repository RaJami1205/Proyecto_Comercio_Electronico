/** Resuelve identidades y coordina descartes consentidos; no posee Orders ni persistencia. */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { SessionContext, type SessionState, type TransactionState } from './SessionContext'
import { useCart } from '../hooks/useCart'
import { sessionApi, sessionErrorMessage } from '../services/sessionApi'
import type { ResolvedUser } from '../types/user'
import { trackEvent } from '../services/analytics'

/** Determina cuándo Checkout o una transacción impiden cambiar la identidad activa. */
function transitionReason(state: SessionState): string | null {
  if (state.transaction === 'active' || state.transaction === 'uncertain') return 'Resuelve el intento de compra pendiente antes de cambiar de identidad.'
  return state.checkoutMounted ? 'Sal de Checkout de forma segura antes de cambiar de identidad.' : null
}

/** Explica el bloqueo de compra según el Cart, la transición de sesión y el rol resuelto. */
function purchaseReason(state: SessionState, conflict: boolean): string | null {
  if (conflict) return 'Hay un cambio de carrito de otra pestaña pendiente de revisión.'
  if (state.dialog || state.resolving) return 'Completa o cancela el cambio de sesión antes de comprar.'
  if (!state.user) return 'Inicia una sesión simulada B2C para finalizar la compra.'
  if (state.user.role !== 'B2C') return 'Checkout disponible temporalmente solo para B2C. El catálogo muestra precios Retail.'
  return null
}

/** Mantiene la sesión simulada en memoria y publica SESSION_STARTED una vez por transición a una identidad resuelta. */
export default function SessionProvider({ children }: { children: ReactNode }) {
  const { getSnapshot, clearCart, hasExternalConflict } = useCart()
  const [state, setState] = useState<SessionState>({ user: null, dialog: null, pending: null,
    resolving: false, error: null, epoch: 0, checkoutMounted: false, transaction: 'idle' })
  const current = useRef(state)
  const operation = useRef(0)
  const controller = useRef<AbortController | null>(null)
  const transitionSequence = useRef(0)
  const publishedTransition = useRef<number | null>(null)
  const [identityTransition, setIdentityTransition] = useState<{ id: number; user: ResolvedUser } | null>(null)

  // Observa una transición explícita después del commit de React; no registra renders ordinarios.
  useEffect(() => {
    if (!identityTransition || state.user !== identityTransition.user || publishedTransition.current === identityTransition.id) return
    publishedTransition.current = identityTransition.id
    trackEvent({ type: 'SESSION_STARTED', occurredAt: new Date().toISOString(), metadata: { role: identityTransition.user.role } }, identityTransition.user.id)
  }, [identityTransition, state.user])

  /** Mantiene la referencia de los handlers sincronizada con el siguiente estado de React. */
  const update = useCallback((change: Partial<SessionState>) => {
    current.current = { ...current.current, ...change }
    setState(current.current)
  }, [])
  /** Cancela la resolución en curso e invalida su respuesta aunque llegue después. */
  const invalidate = useCallback(() => {
    operation.current += 1
    controller.current?.abort()
    controller.current = null
  }, [])
  useEffect(() => invalidate, [invalidate])

  /** Comprueba la guarda de transición y comunica el motivo del bloqueo al diálogo. */
  function allowed() {
    const reason = transitionReason(current.current)
    if (reason) update({ error: reason })
    return !reason
  }
  /** Aplica la transición y avanza el epoch solo cuando corresponde a un cambio de identidad. */
  function commit(user: ResolvedUser | null, kind: 'identity' | 'conflict') {
    invalidate()
    update({ user, dialog: null, pending: null, resolving: false, error: null,
      epoch: current.current.epoch + (kind === 'identity' ? 1 : 0) })
    setIdentityTransition(kind === 'identity' && user ? { id: ++transitionSequence.current, user } : null)
  }
  /** Captura la revisión del Cart que requiere consentimiento o aplica la transición directamente. */
  function prepare(user: ResolvedUser | null, kind: 'identity' | 'conflict' = 'identity') {
    const cart = getSnapshot()
    if (cart.items.length || cart.hasExternalConflict) {
      update({ resolving: false, error: null, pending: { user, kind, cartRevision: cart.revision } })
    } else commit(user, kind)
  }
  /** Abre el selector si la sesión admite una transición. */
  function openLogin() {
    if (!allowed() || current.current.resolving) return
    invalidate()
    update({ dialog: 'login', pending: null, error: null })
  }
  /** Prepara el cierre de la sesión activa con las mismas guardas de descarte del Cart. */
  function requestLogout() {
    if (!allowed() || current.current.resolving || !current.current.user) return
    update({ dialog: 'logout', pending: null, error: null })
    prepare(null)
  }
  /** Resuelve la identidad en el Server y prepara el cambio solo si la respuesta sigue vigente. */
  async function resolveUser(userId: string) {
    if (!allowed() || current.current.resolving || current.current.dialog !== 'login') return
    invalidate()
    const requestId = operation.current
    const abort = new AbortController()
    controller.current = abort
    update({ resolving: true, pending: null, error: null })
    try {
      const user = await sessionApi.resolveUser(userId, abort.signal)
      if (abort.signal.aborted || requestId !== operation.current) return
      if (!allowed()) { update({ resolving: false }); return }
      if (JSON.stringify(user) === JSON.stringify(current.current.user)) {
        update({ dialog: null, resolving: false, error: null })
        return
      }
      prepare(user)
    } catch (error) {
      if (!abort.signal.aborted && requestId === operation.current) update({ resolving: false, error: sessionErrorMessage(error) })
    }
  }
  /** Descarta el Cart solo bajo consentimiento para la revisión actual antes de aplicar el cambio pendiente. */
  function confirmTransition(consentRevision: number) {
    if (!allowed() || current.current.resolving) return
    const pending = current.current.pending
    if (!pending || consentRevision !== pending.cartRevision) return
    const cart = getSnapshot()
    if (cart.revision !== pending.cartRevision) {
      update({ pending: { ...pending, cartRevision: cart.revision }, error: 'El carrito cambió. Revisa el estado actual y confirma nuevamente el descarte.' })
      return
    }
    clearCart()
    commit(pending.user, pending.kind)
  }
  /** Cierra el diálogo e invalida cualquier resolución pendiente. */
  function cancelTransition() {
    invalidate()
    update({ dialog: null, pending: null, resolving: false, error: null })
  }
  /** Prepara la revisión de un conflicto entre pestañas manteniendo la identidad actual. */
  function resolveCartConflict() {
    if (!allowed() || current.current.resolving) return
    invalidate()
    update({ dialog: 'conflict', pending: null, error: null })
    prepare(current.current.user, 'conflict')
  }
  /** Comunica la presencia de Checkout a la guarda de cambio de identidad. */
  const setCheckoutMounted = useCallback((mounted: boolean) => {
    if (current.current.checkoutMounted !== mounted) update({ checkoutMounted: mounted })
  }, [update])
  /** Actualiza el estado transaccional que consultan las guardas de sesión. */
  const setTransactionState = useCallback((transaction: TransactionState) => {
    if (current.current.transaction !== transaction) update({ transaction })
  }, [update])
  /** Consulta el estado vigente para proteger intentos activos o de resultado incierto. */
  const isTransactionBlocked = useCallback(() => current.current.transaction === 'active' || current.current.transaction === 'uncertain', [])
  /** Evalúa la compra en el momento de la acción con el snapshot actual del Cart. */
  const getPurchaseBlockReason = useCallback(() => purchaseReason(current.current, getSnapshot().hasExternalConflict), [getSnapshot])

  return <SessionContext.Provider value={{ ...state, transitionBlockReason: transitionReason(state),
    purchaseBlockReason: purchaseReason(state, hasExternalConflict), openLogin, requestLogout, resolveUser,
    confirmTransition, cancelTransition, resolveCartConflict, setCheckoutMounted, setTransactionState,
    isTransactionBlocked, getPurchaseBlockReason }}>{children}</SessionContext.Provider>
}
