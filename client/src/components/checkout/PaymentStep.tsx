import { useState } from 'react'
import type { Order } from '../../types/order'
import type { PaymentScenario } from '../../types/payment'
import styles from '../../styles/checkout/PaymentStep.module.css'
import pageStyles from '../../styles/pages/CheckoutPage.module.css'

interface PaymentStepProps {
  order: Order
  selectedScenario: PaymentScenario | null
  onScenarioChange: (scenario: PaymentScenario) => void
  onProcessPayment: () => void
  isProcessingPayment: boolean
  /** true cuando la orden ya quedó CONFIRMED/APPROVED: no debe aceptar más intentos de pago. */
  locked?: boolean
  scenarioLocked?: boolean
  error?: string
}

const scenarios: { id: PaymentScenario; label: string; description: string }[] = [
  {
    id: 'PAYMENT_APPROVED',
    label: 'Aprobar pago',
    description: 'Simula un pago exitoso. La orden quedará confirmada.',
  },
  {
    id: 'PAYMENT_DECLINED',
    label: 'Rechazar pago',
    description: 'Simula un pago rechazado. Podrás intentarlo de nuevo.',
  },
  {
    id: 'PAYMENT_ERROR',
    label: 'Error del servicio',
    description: 'Simula un error del Sandbox. Podrás intentarlo de nuevo.',
  },
]

// Formatea "1234567812345678" -> "1234 5678 1234 5678" (máx 16 dígitos).
function formatCardNumber(raw: string): string {
  const digits = raw.replace(/\D/g, '').slice(0, 16)
  return digits.replace(/(.{4})/g, '$1 ').trim()
}

// Formatea "1225" -> "12/25" mientras se escribe (máx 4 dígitos: MMAA).
function formatExpiry(raw: string): string {
  const digits = raw.replace(/\D/g, '').slice(0, 4)
  if (digits.length <= 2) return digits
  return `${digits.slice(0, 2)}/${digits.slice(2)}`
}

function formatCvv(raw: string): string {
  return raw.replace(/\D/g, '').slice(0, 3)
}

// Valida solo forma/longitud, nunca el número real de una tarjeta (no existe pasarela detrás).
function isCardComplete(cardNumber: string, cardName: string, cardExpiry: string, cardCvv: string): boolean {
  const digitsOnly = cardNumber.replace(/\D/g, '')
  const expiryMatch = /^(\d{2})\/(\d{2})$/.exec(cardExpiry)
  const month = expiryMatch ? Number(expiryMatch[1]) : 0
  return (
    digitsOnly.length === 16 &&
    cardName.trim().length > 0 &&
    expiryMatch !== null &&
    month >= 1 &&
    month <= 12 &&
    cardCvv.length === 3
  )
}

/**
 * Campos de tarjeta puramente decorativos: su estado vive solo aquí, dentro
 * de este componente. Nunca se leen desde fuera, nunca viajan en el payload
 * de processPayment (que solo manda { scenario, idempotencyKey }) y no se
 * guardan en ningún lado. Existen para que la pantalla se vea completa en
 * un flujo de Payment Sandbox que no tiene pasarela de pagos real detrás.
 */
function PaymentStep({
  order,
  selectedScenario,
  onScenarioChange,
  onProcessPayment,
  isProcessingPayment,
  locked,
  scenarioLocked,
  error,
}: PaymentStepProps) {
  const [cardNumber, setCardNumber] = useState('')
  const [cardName, setCardName] = useState('')
  const [cardExpiry, setCardExpiry] = useState('')
  const [cardCvv, setCardCvv] = useState('')

  const disabled = isProcessingPayment || Boolean(locked)
  const cardComplete = isCardComplete(cardNumber, cardName, cardExpiry, cardCvv)

  const money = (value: number) =>
    new Intl.NumberFormat('es-CR', { style: 'currency', currency: order.currency }).format(value)

  return (
    <div className={styles.layout}>
      <div role="note" className={styles.sandboxBanner}>
        <strong>Payment Sandbox — entorno de simulación.</strong>{' '}
        No se procesará ningún pago real. Usa únicamente datos ficticios de demostración en los campos de tarjeta.
        Deben estar completos para continuar, pero nunca se envían a ningún servidor ni se guardan en ningún lado.
      </div>

      <dl className={styles.orderSummary}>
        <div>
          <dt>Orden</dt>
          <dd>{order.orderNumber}</dd>
        </div>
        <div>
          <dt>Total a pagar</dt>
          <dd className={styles.total}>{money(order.totals.total)}</dd>
        </div>
        <div>
          <dt>Moneda</dt>
          <dd>{order.currency}</dd>
        </div>
      </dl>

      <fieldset className={styles.cardFields} disabled={disabled}>
        <legend>Datos de la tarjeta (demostrativo, no se guarda)</legend>

        <label className={styles.field}>
          <span>Número de tarjeta</span>
          <input
            type="text"
            inputMode="numeric"
            autoComplete="off"
            placeholder="1234 5678 9012 3456"
            value={cardNumber}
            onChange={(event) => setCardNumber(formatCardNumber(event.target.value))}
          />
        </label>

        <label className={styles.field}>
          <span>Nombre en la tarjeta</span>
          <input
            type="text"
            autoComplete="off"
            placeholder="Nombre completo"
            value={cardName}
            onChange={(event) => setCardName(event.target.value)}
          />
        </label>

        <div className={styles.fieldRow}>
          <label className={styles.field}>
            <span>Vencimiento</span>
            <input
              type="text"
              inputMode="numeric"
              autoComplete="off"
              placeholder="MM/AA"
              value={cardExpiry}
              onChange={(event) => setCardExpiry(formatExpiry(event.target.value))}
            />
          </label>

          <label className={styles.field}>
            <span>CVV</span>
            <input
              type="password"
              inputMode="numeric"
              autoComplete="off"
              placeholder="231"
              maxLength={3}
              value={cardCvv}
              onChange={(event) => setCardCvv(formatCvv(event.target.value))}
            />
          </label>
        </div>
      </fieldset>

      <fieldset className={styles.scenarios} disabled={disabled || scenarioLocked}>
        <legend>Selecciona un escenario</legend>
        {scenarios.map((scenario) => (
          <label
            key={scenario.id}
            className={`${styles.scenarioCard} ${
              selectedScenario === scenario.id ? styles.scenarioCardSelected : ''
            }`}
          >
            <input
              type="radio"
              name="payment-scenario"
              value={scenario.id}
              checked={selectedScenario === scenario.id}
              onChange={() => onScenarioChange(scenario.id)}
            />
            <span className={styles.scenarioText}>
              <strong>{scenario.label}</strong>
              <code>{scenario.id}</code>
              <span className={styles.scenarioDescription}>{scenario.description}</span>
            </span>
          </label>
        ))}
      </fieldset>

      {error ? (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      ) : null}

      {scenarioLocked && !isProcessingPayment ? (
        <p role="status">
          El resultado de este intento aún no está confirmado. Reintentar conserva la misma solicitud.
          Al salir conservas los productos del carrito, pero se perderán los datos temporales del Checkout y la identidad del intento.
          Salir no cancela el pago ni confirma su resultado; iniciar otro Checkout puede crear una nueva operación.
        </p>
      ) : null}

      <div className={pageStyles.actions}>
        <button
          type="button"
          className={pageStyles.continue}
          disabled={!selectedScenario || !cardComplete || disabled}
          onClick={onProcessPayment}
        >
          {isProcessingPayment ? 'Procesando pago…' : 'Procesar pago'}
        </button>
      </div>

      {!cardComplete && !disabled ? (
        <p className={styles.hint}>Completa los datos de tarjeta para poder procesar el pago.</p>
      ) : null}

      <p role="status" aria-live="polite" className={styles.visuallyHidden}>
        {isProcessingPayment ? 'Procesando tu pago. Espera un momento.' : ''}
      </p>
    </div>
  )
}

export default PaymentStep
