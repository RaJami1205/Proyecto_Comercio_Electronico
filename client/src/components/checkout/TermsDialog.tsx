import { useEffect, useRef } from 'react'
import { termsPolicy } from '../../content/terms'
import TermsContent from '../policies/TermsContent'
import styles from '../../styles/checkout/TermsDialog.module.css'

interface TermsDialogProps {
  onClose: () => void
  versionRejected?: boolean
}

/** Consulta local: no navega ni registra consentimiento. */
function TermsDialog({ onClose, versionRejected = false }: TermsDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const triggerRef = useRef<HTMLElement | null>(null)
  const restoreFrameRef = useRef<number | null>(null)

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (restoreFrameRef.current !== null) cancelAnimationFrame(restoreFrameRef.current)
    if (!triggerRef.current && document.activeElement instanceof HTMLElement) triggerRef.current = document.activeElement
    const overflow = document.body.style.overflow
    const paddingRight = document.body.style.paddingRight
    const scrollbar = window.innerWidth - document.documentElement.clientWidth
    const padding = Number.parseFloat(getComputedStyle(document.body).paddingRight) || 0
    dialog.showModal()
    document.body.style.overflow = 'hidden'
    if (scrollbar > 0) document.body.style.paddingRight = `${padding + scrollbar}px`
    closeRef.current?.focus()
    return () => {
      if (dialog.open) dialog.close()
      document.body.style.overflow = overflow
      document.body.style.paddingRight = paddingRight
      restoreFrameRef.current = requestAnimationFrame(() => {
        const trigger = triggerRef.current
        if (trigger?.isConnected && !trigger.closest('[hidden], [inert]') && trigger.getClientRects().length > 0) {
          trigger.focus({ preventScroll: true })
        }
      })
    }
  }, [])

  return (
    <dialog ref={dialogRef} className={styles.dialog} aria-labelledby="checkout-terms-title"
      onCancel={event => { event.preventDefault(); onClose() }}>
      <div className={styles.heading}>
        <h1 id="checkout-terms-title">{termsPolicy.title}</h1>
        <button ref={closeRef} type="button" onClick={onClose} aria-label="Cerrar Términos y Condiciones">Cerrar</button>
      </div>
      <div className={styles.content}>
        <p>{termsPolicy.introduction}</p>
        <TermsContent versionRejected={versionRejected} />
      </div>
    </dialog>
  )
}

export default TermsDialog
