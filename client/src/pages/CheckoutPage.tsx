import { useEffect, useRef, useState } from 'react'
import CheckoutStepper, { type CheckoutStep } from '../components/checkout/CheckoutStepper'
import BuyerStep from '../components/checkout/BuyerStep'
import DeliveryStep from '../components/checkout/DeliveryStep'
import type { CheckoutData } from '../types/checkout'
import Header from '../components/layout/Header'
import Footer from '../components/layout/Footer'
import styles from '../styles/pages/CheckoutPage.module.css'

interface CheckoutPageProps {
  onBackToCart: () => void
  onCatalogClick: (hash?: '#top' | '#catalog') => void
  onCartClick: () => void
}

const stages: Record<CheckoutStep, { title: string; description: string; previous?: CheckoutStep; next?: CheckoutStep }> = {
  buyer: { title: 'Comprador', description: 'Completa tus datos de contacto.', next: 'delivery' },
  delivery: { title: 'Entrega', description: 'Indica la dirección de entrega.', previous: 'buyer', next: 'review' },
  review: { title: 'Revisión', description: 'Aquí podrás revisar los detalles de tu compra. El resumen estará disponible próximamente.', previous: 'delivery', next: 'payment' },
  payment: { title: 'Pago', description: 'La etapa de pago estará disponible próximamente. Todavía no se pueden realizar pagos.', previous: 'review' },
}

/** Conserva borradores solo en memoria; se reinicia al volver a entrar. */
function CheckoutPage({ onBackToCart, onCatalogClick, onCartClick }: CheckoutPageProps) {
  const [currentStep, setCurrentStep] = useState<CheckoutStep>('buyer')
  const [data, setData] = useState<CheckoutData>({
    buyer: { fullName: '', email: '', phone: '' },
    delivery: { province: '', canton: '', address: '', additionalInfo: '' },
  })
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
            {currentStep === 'buyer' ? (
              <BuyerStep
                value={data.buyer}
                onChange={(buyer) => setData((current) => ({ ...current, buyer }))}
                onContinue={(buyer) => {
                  setData((current) => ({ ...current, buyer }))
                  changeStep('delivery')
                }}
                onBack={onBackToCart}
              />
            ) : currentStep === 'delivery' ? (
              <DeliveryStep
                value={data.delivery}
                onChange={(delivery) => setData((current) => ({ ...current, delivery }))}
                onContinue={(delivery) => {
                  setData((current) => ({ ...current, delivery }))
                  changeStep('review')
                }}
                onBack={() => changeStep('buyer')}
              />
            ) : (
            <div className={styles.actions}>
              <button type="button" className={styles.back} onClick={() => stage.previous ? changeStep(stage.previous) : onBackToCart()}>
                {stage.previous ? 'Atrás' : 'Volver al carrito'}
              </button>
              {stage.next ? (
                <button type="button" className={styles.continue} onClick={() => changeStep(stage.next)}>Continuar</button>
              ) : null}
            </div>
            )}
          </section>
        </div>
      </main>
      <Footer onCatalogClick={onCatalogClick} />
    </div>
  )
}

export default CheckoutPage
