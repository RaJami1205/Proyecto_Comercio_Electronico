import { useEffect, useRef, useState } from 'react'
import CheckoutStepper, { type CheckoutStep } from '../components/checkout/CheckoutStepper'
import Header from '../components/layout/Header'
import Footer from '../components/layout/Footer'
import styles from '../styles/pages/CheckoutPage.module.css'

interface CheckoutPageProps {
  onBackToCart: () => void
  onCatalogClick: (hash?: '#top' | '#catalog') => void
  onCartClick: () => void
}

const stages: Record<CheckoutStep, { title: string; description: string; previous?: CheckoutStep; next?: CheckoutStep }> = {
  buyer: { title: 'Comprador', description: 'Aquí podrás completar tus datos de contacto. El formulario estará disponible próximamente.', next: 'delivery' },
  delivery: { title: 'Entrega', description: 'Aquí podrás indicar la dirección de entrega. El formulario estará disponible próximamente.', previous: 'buyer', next: 'review' },
  review: { title: 'Revisión', description: 'Aquí podrás revisar los detalles de tu compra. El resumen estará disponible próximamente.', previous: 'delivery', next: 'payment' },
  payment: { title: 'Pago', description: 'La etapa de pago estará disponible próximamente. Todavía no se pueden realizar pagos.', previous: 'review' },
}

/** Shell sin datos ni operaciones transaccionales; se reinicia al volver a entrar. */
function CheckoutPage({ onBackToCart, onCatalogClick, onCartClick }: CheckoutPageProps) {
  const [currentStep, setCurrentStep] = useState<CheckoutStep>('buyer')
  const pageHeadingRef = useRef<HTMLHeadingElement>(null)
  const stageHeadingRef = useRef<HTMLHeadingElement>(null)
  const stageChangedRef = useRef(false)
  const stage = stages[currentStep]

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const target = stageChangedRef.current ? stageHeadingRef.current : pageHeadingRef.current
      target?.focus({ preventScroll: true })
    })
    return () => cancelAnimationFrame(frame)
  }, [currentStep])

  function changeStep(next: CheckoutStep | undefined) {
    if (!next) return
    stageChangedRef.current = true
    setCurrentStep(next)
  }

  return (
    <div className={styles.page}>
      <Header checkoutView onCartClick={onCartClick} onCatalogClick={onCatalogClick} />
      <main className={styles.main}>
        <div className={styles.container}>
          <p className={styles.eyebrow}>Tu compra, paso a paso</p>
          <h1 ref={pageHeadingRef} tabIndex={-1} data-app-heading>Finalizar compra</h1>
          <CheckoutStepper currentStep={currentStep} />
          <section className={styles.stage} aria-labelledby="checkout-stage-title">
            <h2 id="checkout-stage-title" ref={stageHeadingRef} tabIndex={-1}>{stage.title}</h2>
            <p>{stage.description}</p>
            <div className={styles.actions}>
              <button type="button" className={styles.back} onClick={() => stage.previous ? changeStep(stage.previous) : onBackToCart()}>
                {stage.previous ? 'Atrás' : 'Volver al carrito'}
              </button>
              {stage.next ? (
                <button type="button" className={styles.continue} onClick={() => changeStep(stage.next)}>Continuar</button>
              ) : null}
            </div>
          </section>
        </div>
      </main>
      <Footer onCatalogClick={onCatalogClick} />
    </div>
  )
}

export default CheckoutPage
