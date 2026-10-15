import { useEffect, useRef, useState } from 'react'
import CheckoutStepper, { type CheckoutStep } from '../components/checkout/CheckoutStepper'
import BuyerStep from '../components/checkout/BuyerStep'
import DeliveryStep from '../components/checkout/DeliveryStep'
import ReviewStep from '../components/checkout/ReviewStep'
import PaymentStep from '../components/checkout/PaymentStep'
import PaymentResultPanel from '../components/checkout/PaymentResultPanel'
import OrderConfirmationPage from './OrderConfirmationPage'
import type { CheckoutData } from '../types/checkout'
import type { CreateOrderRequest, Order } from '../types/order'
import type { PaymentResult, PaymentScenario, ProcessPaymentRequest } from '../types/payment'
import type { CartItem } from '../types/cart'
import { useCart } from '../hooks/useCart'
import { calculateCartTotals, calculateLineSubtotal } from '../utils/cartCalculations'
import { normalizeBuyer, normalizeDelivery, validateBuyer, validateDelivery } from '../utils/checkoutValidation'
import { orderApi, OrderApiError, orderErrorMessage } from '../services/orderApi'
import { paymentApi, paymentErrorMessage } from '../services/paymentApi'
import { orderReviewDifferences } from '../utils/orderReviewDifferences'
import Header from '../components/layout/Header'
import Footer from '../components/layout/Footer'
import styles from '../styles/pages/CheckoutPage.module.css'

interface CheckoutPageProps {
  onBackToCart: () => void
  onCatalogClick: (hash?: '#top' | '#catalog') => void
  onCartClick: () => void
  onNavigationLockChange: (busy: boolean) => void
  onOrderCreated: () => void
}
interface CreationAttempt { request: CreateOrderRequest; items: CartItem[] }
type PaymentAttempt = Readonly<ProcessPaymentRequest & { orderId: string }>
const stages: Record<CheckoutStep, { title: string; description: string }> = {
  buyer: { title: 'Comprador', description: 'Completa tus datos de contacto.' },
  delivery: { title: 'Entrega', description: 'Indica la dirección de entrega.' },
  review: { title: 'Revisión', description: 'Revisa tus datos y productos antes de confirmar la compra.' },
  payment: { title: 'Pago', description: 'Elige un escenario del Payment Sandbox para simular el resultado de tu pago. No se procesará ningún pago real.' },
}

/** Buyer, Delivery, intento y Order viven exclusivamente dentro de este Checkout. */
function CheckoutPage({ onBackToCart, onCatalogClick, onCartClick, onNavigationLockChange, onOrderCreated }: CheckoutPageProps) {
  const { items, clearCart } = useCart()
  const [currentStep, setCurrentStep] = useState<CheckoutStep>('buyer')
  const [data, setData] = useState<CheckoutData>({ buyer: { fullName: '', email: '', phone: '' }, delivery: { province: '', canton: '', address: '', additionalInfo: '' } })
  const [order, setOrder] = useState<Order>()
  const [differences, setDifferences] = useState<string[]>([])
  const [isCreatingOrder, setIsCreatingOrder] = useState(false)
  const [error, setError] = useState<string>()
  const [attempt, setAttempt] = useState<CreationAttempt>()
  const [selectedPaymentScenario, setSelectedPaymentScenario] = useState<PaymentScenario | null>(null)
  const [isProcessingPayment, setIsProcessingPayment] = useState(false)
  const [hasPendingPayment, setHasPendingPayment] = useState(false)
  const [paymentError, setPaymentError] = useState<string>()
  // Último PaymentResult crudo del Server; es la fuente para decidir qué pantalla de
  // resultado mostrar (CN-32). Se limpia al pedir un Retry, lo que vuelve a mostrar el form.
  const [paymentResult, setPaymentResult] = useState<PaymentResult>()
  const attemptRef = useRef<CreationAttempt | undefined>(undefined)
  const submittingRef = useRef(false)
  const paymentAttemptRef = useRef<PaymentAttempt | undefined>(undefined)
  const paymentSubmittingRef = useRef(false)
  const paymentResultRef = useRef<PaymentResult | undefined>(undefined)
  // Garantiza que el Cart se limpie una sola vez por confirmación (CN-33), incluso si
  // algo disparara un re-render extra del mismo resultado APPROVED.
  const cartClearedRef = useRef(false)
  const pageHeadingRef = useRef<HTMLHeadingElement>(null)
  const stageHeadingRef = useRef<HTMLHeadingElement>(null)
  const stageChangedRef = useRef(false)
  const confirmed = order?.orderStatus === 'CONFIRMED' && order.paymentStatus === 'APPROVED'
  const stage = confirmed
    ? { title: 'Orden confirmada', description: 'Recuperamos una orden existente con pago aprobado. No necesitas realizar otro pago.' }
    : stages[currentStep]
  const reviewItems = attempt?.items ?? items
  const invalid = Object.keys(validateBuyer(data.buyer)).length > 0 || Object.keys(validateDelivery(data.delivery)).length > 0
    || reviewItems.length === 0 || reviewItems.some(item => !Number.isSafeInteger(item.quantity) || item.quantity <= 0)

  useEffect(() => {
    // El panel administra el foco cuando se presenta un resultado de pago.
    if (currentStep === 'payment' && paymentResult) return
    const frame = requestAnimationFrame(() => {
      const target = stageChangedRef.current ? stageHeadingRef.current : pageHeadingRef.current
      target?.focus({ preventScroll: true })
    })
    return () => cancelAnimationFrame(frame)
  }, [currentStep, order, paymentResult])

  function changeStep(next: CheckoutStep) {
    if (submittingRef.current || paymentSubmittingRef.current || confirmed) return
    if (next === 'payment' && !order) return
    if (attemptRef.current && next !== 'review' && next !== 'payment') return
    stageChangedRef.current = true
    setError(undefined)
    setCurrentStep(next)
  }

  async function confirmOrder() {
    if (submittingRef.current || paymentSubmittingRef.current || confirmed || (!order && invalid)) return
    if (order) {
      setDifferences([])
      onNavigationLockChange(false)
      changeStep('payment')
      return
    }
    // El ref protege incluso clicks ocurridos antes del siguiente render de React.
    submittingRef.current = true
    setIsCreatingOrder(true)
    onNavigationLockChange(true)
    setError(undefined)
    let requiresAcceptance = false
    try {
      const activeAttempt = attemptRef.current ?? {
        request: {
          buyer: normalizeBuyer(data.buyer), delivery: normalizeDelivery(data.delivery),
          items: items.map(({ productId, quantity }) => ({ productId, quantity })),
          idempotencyKey: crypto.randomUUID(),
        },
        items: items.map(item => ({ ...item })),
      }
      attemptRef.current = activeAttempt
      setAttempt(activeAttempt)
      const created = await orderApi.createOrder(activeAttempt.request)
      const alreadyConfirmed = created.orderStatus === 'CONFIRMED' && created.paymentStatus === 'APPROVED'
      const changes = alreadyConfirmed ? [] : orderReviewDifferences(activeAttempt.items, created)
      requiresAcceptance = changes.length > 0
      setDifferences(changes)
      setOrder(created)
      onOrderCreated()
      attemptRef.current = undefined
      setAttempt(undefined)
      stageChangedRef.current = true
      setCurrentStep(alreadyConfirmed || requiresAcceptance ? 'review' : 'payment')
    } catch (failure) {
      if (failure instanceof OrderApiError && failure.conclusive) {
        attemptRef.current = undefined
        setAttempt(undefined)
      }
      setError(orderErrorMessage(failure))
    } finally {
      submittingRef.current = false
      setIsCreatingOrder(false)
      onNavigationLockChange(Boolean(attemptRef.current) || requiresAcceptance)
    }
  }

  function changePaymentScenario(scenario: PaymentScenario) {
    if (paymentSubmittingRef.current || paymentAttemptRef.current || paymentResultRef.current || confirmed) return
    setSelectedPaymentScenario(scenario)
  }

  async function handleProcessPayment() {
    // Guarda de doble-submit / múltiples Retry concurrentes: el ref cubre clicks antes
    // del siguiente render; isProcessingPayment refleja el bloqueo en la UI.
    if (paymentSubmittingRef.current || submittingRef.current || paymentResultRef.current || confirmed || !order || !selectedPaymentScenario) return

    paymentSubmittingRef.current = true
    setIsProcessingPayment(true)
    setPaymentError(undefined)
    onNavigationLockChange(true)

    try {
      const activeAttempt = paymentAttemptRef.current ?? Object.freeze({
        orderId: order.id, scenario: selectedPaymentScenario, idempotencyKey: crypto.randomUUID(),
      })
      paymentAttemptRef.current = activeAttempt
      setHasPendingPayment(true)
      const result = await paymentApi.processPayment(activeAttempt.orderId, activeAttempt)
      // Resultado concluyente (APPROVED/DECLINED/ERROR): el intento queda cerrado,
      // así que el próximo "Procesar pago"/Retry debe generar una idempotencyKey nueva.
      paymentAttemptRef.current = undefined
      setHasPendingPayment(false)
      paymentResultRef.current = result
      // La Order que viene en la respuesta reemplaza por completo el snapshot anterior;
      // nunca inferimos o simulamos orderStatus/paymentStatus en el Client.
      setOrder(result.order)
      setPaymentResult(result)

      // CN-33: el Cart se limpia únicamente después de un PAYMENT_APPROVED real, nunca
      // antes (no en Review, no al crear la Order, no mientras el pago está en proceso),
      // y solo una vez por confirmación. La Confirmation no depende de esto para
      // renderizarse: usa la Order, que vive aparte en este mismo state.
      if (result.result === 'PAYMENT_APPROVED' && !cartClearedRef.current) {
        cartClearedRef.current = true
        clearCart()
      }
    } catch (failure) {
      setPaymentError(paymentErrorMessage(failure))
    } finally {
      paymentSubmittingRef.current = false
      setIsProcessingPayment(false)
      onNavigationLockChange(false)
    }
  }

  function handlePaymentRetry() {
    if (paymentSubmittingRef.current || paymentAttemptRef.current || confirmed
      || !paymentResultRef.current || paymentResultRef.current.result === 'PAYMENT_APPROVED') return
    // Retry: misma Order, nuevo intento. El usuario vuelve a elegir escenario
    // explícitamente (nunca queda uno preseleccionado) y la próxima llamada a
    // processPayment generará una idempotencyKey nueva para el siguiente intento.
    paymentResultRef.current = undefined
    setPaymentResult(undefined)
    setSelectedPaymentScenario(null)
    setPaymentError(undefined)
  }

  function abandonCheckout() {
    if (submittingRef.current || paymentSubmittingRef.current) return
    // La salida es explícita: no cancela ni recrea la Order y no modifica Cart.
    onNavigationLockChange(false)
    onBackToCart()
  }

  // CN-33: a partir de aquí existe una Order CONFIRMED/APPROVED. Se presenta la vista
  // dedicada de Confirmation en vez del layout de Checkout — ya no hay stepper, ya no
  // hay forma de volver a Payment, y "Volver al catálogo" reemplaza cualquier acción
  // de edición. La Order sigue viva en este mismo state, independiente del Cart (que
  // ya se vació arriba): Confirmation nunca depende de CartState para renderizarse.
  if (confirmed && order) {
    return <OrderConfirmationPage order={order} onCatalogClick={onCatalogClick} onCartClick={onCartClick} />
  }

  const displayItems = order?.items ?? reviewItems.map(item => ({ productId: item.productId, name: item.name, image: item.image, unitPrice: item.price, quantity: item.quantity, lineSubtotal: calculateLineSubtotal(item.price, item.quantity) }))
  const lockNavigation = isCreatingOrder || isProcessingPayment || Boolean(attempt) || differences.length > 0
  return (
    <div className={styles.page}>
      <div inert={lockNavigation}><Header checkoutView onCartClick={onCartClick} onCatalogClick={onCatalogClick} /></div>
      <main className={styles.main}>
        <div className={styles.container}>
          <p className={styles.eyebrow}>Tu compra, paso a paso</p>
          <h1 ref={pageHeadingRef} tabIndex={-1} data-app-heading>Finalizar compra</h1>
          <CheckoutStepper currentStep={currentStep} />
          <section className={styles.stage} aria-labelledby="checkout-stage-title" aria-busy={isCreatingOrder || isProcessingPayment}>
            <h2 id="checkout-stage-title" ref={stageHeadingRef} tabIndex={-1}>{stage.title}</h2>
            <p>{stage.description}</p>
            {currentStep === 'buyer' ? (
              <BuyerStep value={data.buyer} onChange={buyer => setData(current => ({ ...current, buyer }))}
                onContinue={buyer => { setData(current => ({ ...current, buyer })); changeStep('delivery') }} onBack={onBackToCart} />
            ) : currentStep === 'delivery' ? (
              <DeliveryStep value={data.delivery} onChange={delivery => setData(current => ({ ...current, delivery }))}
                onContinue={delivery => { setData(current => ({ ...current, delivery })); changeStep('review') }} onBack={() => changeStep('buyer')} />
            ) : currentStep === 'payment' && order ? (
              <>
                {paymentResult ? (
                  <PaymentResultPanel
                    result={paymentResult.result}
                    order={order}
                    onRetry={paymentResult.result !== 'PAYMENT_APPROVED' ? handlePaymentRetry : undefined}
                  />
                ) : (
                  <PaymentStep
                    order={order}
                    selectedScenario={selectedPaymentScenario}
                    onScenarioChange={changePaymentScenario}
                    onProcessPayment={handleProcessPayment}
                    isProcessingPayment={isProcessingPayment}
                    locked={confirmed}
                    scenarioLocked={hasPendingPayment}
                    error={paymentError}
                  />
                )}
                <div className={styles.actions}>
                  <button type="button" className={styles.back} disabled={isProcessingPayment} onClick={() => changeStep('review')}>Revisar orden</button>
                </div>
              </>
            ) : (
              <>
                <ReviewStep buyer={order?.buyer ?? data.buyer} delivery={order?.delivery ?? data.delivery}
                  items={displayItems} totals={order?.totals ?? calculateCartTotals(reviewItems)} order={order}
                  busy={isCreatingOrder} retryPending={Boolean(attempt)} invalid={!order && invalid} error={error}
                  differences={differences}
                  onAbandon={confirmed || attempt || differences.length > 0 ? abandonCheckout : undefined}
                  onEdit={!order ? changeStep : undefined} onConfirm={!confirmed && currentStep === 'review' ? confirmOrder : undefined} />
                <div className={styles.actions}>
                  {currentStep === 'review' && !order ? <button type="button" className={styles.back} disabled={lockNavigation} onClick={() => changeStep('delivery')}>Volver a entrega</button> : null}
                </div>
              </>
            )}
          </section>
        </div>
      </main>
      <div inert={lockNavigation}><Footer onCatalogClick={onCatalogClick} /></div>
    </div>
  )
}
export default CheckoutPage