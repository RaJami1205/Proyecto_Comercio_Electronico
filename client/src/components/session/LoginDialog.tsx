/** Selección y consentimiento explícitos; la identidad vigente pertenece a SessionProvider. */
import { useEffect, useId, useRef, useState } from 'react'
import { useSession } from '../../hooks/useSession'
import { useCart } from '../../hooks/useCart'
import { sessionApi, sessionErrorMessage } from '../../services/sessionApi'
import type { ResolvedUser } from '../../types/user'
import styles from '../../styles/session/LoginDialog.module.css'

export default function LoginDialog() {
  const session = useSession()
  const { items, hasExternalConflict } = useCart()
  const [users, setUsers] = useState<ResolvedUser[]>([])
  const [selected, setSelected] = useState('')
  const [loading, setLoading] = useState(true)
  const [listError, setListError] = useState<string | null>(null)
  const [retry, setRetry] = useState(0)
  const dialog = useRef<HTMLDialogElement>(null)
  const close = useRef<HTMLButtonElement>(null)
  const consentButton = useRef<HTMLButtonElement>(null)
  const select = useRef<HTMLSelectElement>(null)
  const retryButton = useRef<HTMLButtonElement>(null)
  const trigger = useRef<HTMLElement | null>(null)
  const restoreFrame = useRef<number | null>(null)
  const titleId = useId()
  const selectId = useId()
  useEffect(() => { if (session.pending) consentButton.current?.focus() }, [session.pending])
  useEffect(() => {
    if (!loading && !session.pending) {
      if (!listError && users.length) select.current?.focus()
      else retryButton.current?.focus()
    }
  }, [loading, listError, users.length, session.pending])

  useEffect(() => {
    if (session.dialog !== 'login') return
    const controller = new AbortController()
    sessionApi.listUsers(controller.signal).then(result => {
      if (!controller.signal.aborted) { setUsers(result); setLoading(false) }
    }).catch(error => {
      if (!controller.signal.aborted) { setListError(sessionErrorMessage(error)); setLoading(false) }
    })
    return () => controller.abort()
  }, [retry, session.dialog])

  useEffect(() => {
    const element = dialog.current
    if (!element) return
    if (restoreFrame.current !== null) cancelAnimationFrame(restoreFrame.current)
    if (!trigger.current && document.activeElement instanceof HTMLElement) trigger.current = document.activeElement
    const overflow = document.body.style.overflow
    element.showModal()
    document.body.style.overflow = 'hidden'
    close.current?.focus()
    return () => {
      if (element.open) element.close()
      document.body.style.overflow = overflow
      restoreFrame.current = requestAnimationFrame(() => {
        const target = trigger.current
        if (target?.isConnected && !target.closest('[hidden], [inert]') && target.getClientRects().length) target.focus({ preventScroll: true })
      })
    }
  }, [])

  const consent = session.pending !== null
  const title = session.dialog === 'conflict' ? 'Revisar conflicto del carrito'
    : session.dialog === 'logout' ? 'Cerrar sesión simulada' : 'Seleccionar identidad'
  return <dialog ref={dialog} className={styles.dialog} aria-labelledby={titleId}
    onCancel={event => { event.preventDefault(); session.cancelTransition() }}>
    <div className={styles.heading}>
      <h2 id={titleId}>{title}</h2>
      <button ref={close} type="button" onClick={session.cancelTransition}>Cancelar</button>
    </div>
    <div className={styles.content}>
      <p>Simulación académica sin contraseñas ni autenticación real. La sesión se pierde al recargar.</p>
      {session.user ? <p>Identidad actual: <strong>{session.user.displayName}</strong> · {session.user.role}</p> : null}
      {session.error ? <p role="alert">{session.error}</p> : null}
      {consent ? <>
        <p>Para {session.pending?.kind === 'conflict' ? 'resolver el conflicto' : session.pending?.user ? `continuar como ${session.pending.user.displayName}` : 'cerrar sesión'}, debes descartar el carrito actual ({items.length} productos distintos).</p>
        {hasExternalConflict ? <p>Se detectó un cambio externo. No importamos productos de otra pestaña. La clave de guardado sigue compartida: el descarte guardará un carrito vacío y otras pestañas podrán detectar el cambio.</p> : null}
        <p>Este descarte es explícito y no cancela órdenes existentes.</p>
        <button ref={consentButton} className={styles.primary} type="button" disabled={Boolean(session.transitionBlockReason)} onClick={() => { if (session.pending) session.confirmTransition(session.pending.cartRevision) }}>Descartar carrito y continuar</button>
      </> : session.dialog === 'login' ? <>
        {loading ? <p role="status">Cargando identidades…</p> : listError ? <>
          <p role="alert">{listError}</p>
          <button ref={retryButton} type="button" onClick={() => { setLoading(true); setListError(null); setSelected(''); setRetry(value => value + 1) }}>Reintentar listado</button>
        </> : users.length === 0 ? <>
          <p role="status">No hay identidades habilitadas disponibles.</p>
          <button ref={retryButton} type="button" onClick={() => { setLoading(true); setSelected(''); setRetry(value => value + 1) }}>Actualizar listado</button>
        </> : <form onSubmit={event => {
          event.preventDefault()
          if (users.some(user => user.id === selected)) void session.resolveUser(selected)
        }} aria-busy={session.resolving}>
          <label htmlFor={selectId}>Usuario de la simulación</label>
          <select ref={select} id={selectId} value={selected} required disabled={session.resolving}
            onChange={event => setSelected(event.target.value)}>
            <option value="" disabled>Selecciona una identidad</option>
            {users.map(user => <option key={user.id} value={user.id}>{user.displayName} · {user.role}{user.role === 'B2B' ? ` · ${user.company.name}` : ''}</option>)}
          </select>
          <p>El catálogo muestra precios Retail. Por ahora solo B2C puede finalizar compras.</p>
          <button className={styles.primary} type="submit" disabled={!selected || session.resolving || Boolean(session.transitionBlockReason)}>{session.resolving ? 'Validando identidad…' : 'Continuar con esta identidad'}</button>
        </form>}
      </> : null}
      {session.transitionBlockReason ? <p role="status">{session.transitionBlockReason}</p> : null}
    </div>
  </dialog>
}
