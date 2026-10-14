import { useEffect, useRef } from 'react'
import type { Order } from '../../types/order'
import type { PaymentScenario } from '../../types/payment'
import styles from '../../styles/checkout/PaymentResultPanel.module.css'
import pageStyles from '../../styles/pages/CheckoutPage.module.css'

interface PaymentResultPanelProps {
  result: PaymentScenario
  order: Order
  /** Ausente para APPROVED: ese resultado no ofrece Retry. */
  onRetry?: () => void
}

type Verdict = 'approved' | 'declined' | 'error' | 'unexpected'

/**
 * Cruza el PaymentResult con la Order autoritativa devuelta por el Server.
 * Si la combinación no es la esperada (ej. result=APPROVED pero la Order
 * sigue PENDING), el Client NUNCA debe mostrar una compra confirmada:
 * cae a 'unexpected', un estado seguro que no afirma nada que no esté
 * confirmado por el Server.
 */
function resolveVerdict(result: PaymentScenario, order: Order): Verdict {
  if (result === 'PAYMENT_APPROVED') {
    return order.orderStatus === 'CONFIRMED' && order.paymentStatus === 'APPROVED' ? 'approved' : 'unexpected'
  }
  if (result === 'PAYMENT_DECLINED') {
    return order.orderStatus === 'PENDING' && order.paymentStatus === 'DECLINED' ? 'declined' : 'unexpected'
  }
  if (result === 'PAYMENT_ERROR') {
    return order.orderStatus === 'PENDING' && order.paymentStatus === 'ERROR' ? 'error' : 'unexpected'
  }
  return 'unexpected'
}

const content: Record<Verdict, { icon: string; badge: string; title: string; body: string; retryLabel?: string }> = {
  approved: {
    icon: '✓',
    badge: 'Aprobado',
    title: 'Pago aprobado',
    body: 'Tu compra fue procesada correctamente. Estamos preparando la confirmación de tu orden.',
  },
  declined: {
    icon: '✕',
    badge: 'Rechazado',
    title: 'Pago rechazado',
    body: 'El pago no pudo ser aprobado. Tu orden no ha sido confirmada.',
    retryLabel: 'Intentar nuevamente',
  },
  error: {
    icon: '!',
    badge: 'Problema de servicio',
    title: 'No pudimos procesar el pago',
    body: 'Ocurrió un problema con el servicio de pago. No se realizó la compra.',
    retryLabel: 'Reintentar pago',
  },
  unexpected: {
    icon: '!',
    badge: 'Problema inesperado',
    title: 'No pudimos confirmar el resultado de tu pago',
    body: 'Ocurrió un problema inesperado al interpretar la respuesta del servidor. No se confirmó ninguna compra.',
    retryLabel: 'Reintentar pago',
  },
}

function PaymentResultPanel({ result, order, onRetry }: PaymentResultPanelProps) {
  const verdict = resolveVerdict(result, order)
  const data = content[verdict]
  const headingRef = useRef<HTMLHeadingElement>(null)

  // El foco se mueve al bloque de resultado apenas termina el procesamiento,
  // sin depender de que el usuario lo encuentre visualmente.
  useEffect(() => {
    headingRef.current?.focus()
  }, [verdict])

  return (
    <div
      className={`${styles.panel} ${styles[verdict]}`}
      role={verdict === 'approved' ? 'status' : 'alert'}
    >
      <span className={styles.icon} aria-hidden="true">{data.icon}</span>
      <div className={styles.text}>
        <h3 ref={headingRef} tabIndex={-1}>
          <span className={styles.badge}>{data.badge}</span>
          {data.title}
        </h3>
        <p>{data.body}</p>

        {onRetry && data.retryLabel ? (
          <div className={pageStyles.actions}>
            <button type="button" className={pageStyles.continue} onClick={onRetry}>
              {data.retryLabel}
            </button>
          </div>
        ) : null}
      </div>
    </div>
  )
}

export default PaymentResultPanel