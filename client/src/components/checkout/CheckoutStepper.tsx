import styles from '../../styles/checkout/CheckoutStepper.module.css'

export type CheckoutStep = 'buyer' | 'delivery' | 'review' | 'payment'

const steps: { id: CheckoutStep; label: string }[] = [
  { id: 'buyer', label: 'Comprador' },
  { id: 'delivery', label: 'Entrega' },
  { id: 'review', label: 'Revisión' },
  { id: 'payment', label: 'Pago' },
]

/** Indica etapas recorridas, sin afirmar validación ni permitir saltos. */
function CheckoutStepper({ currentStep }: { currentStep: CheckoutStep }) {
  const currentIndex = steps.findIndex((step) => step.id === currentStep)
  return (
    <section aria-label="Progreso de la compra">
      <p className={styles.compact} aria-hidden="true">
        Paso {currentIndex + 1} de 4 · <strong>{steps[currentIndex].label}</strong>
      </p>
      <ol className={styles.steps}>
        {steps.map((step, index) => {
          const status = index < currentIndex ? 'Recorrida' : index === currentIndex ? 'Actual' : 'Próxima'
          return (
            <li
              key={step.id}
              className={`${styles.step} ${index === currentIndex ? styles.current : ''}`}
              aria-current={index === currentIndex ? 'step' : undefined}
            >
              <span className={styles.number} aria-hidden="true">{index + 1}</span>
              <div><strong>{step.label}</strong><span className={styles.status}>{status}</span></div>
            </li>
          )
        })}
      </ol>
    </section>
  )
}

export default CheckoutStepper
