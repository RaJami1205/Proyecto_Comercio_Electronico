/** Coordina las etapas de Checkout, la creación de Order, los intentos de pago y el cierre de compra. */
import { useEffect, useRef, useState } from 'react'
import CheckoutStepper, { type CheckoutStep } from '../components/checkout/CheckoutStepper'
import BuyerStep from '../components/checkout/BuyerStep'
import DeliveryStep from '../components/checkout/DeliveryStep'
import ReviewStep from '../components/checkout/ReviewStep'
import TermsDialog from '../components/checkout/TermsDialog'
import { termsPolicy } from '../content/terms'
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
/** Conserva payload, clave y productos revisados para repetir la misma intención tras una respuesta ambigua. */
interface CreationAttempt { request: CreateOrderRequest; items: CartItem[] }
type PaymentAttempt = Readonly<ProcessPaymentRequest & { orderId: string }>
const stages: Record<CheckoutStep, { title: string; description: string }> = {
  buyer: { title: 'Comprador', description: 'Completa tus datos de contacto.' },
  delivery: { title: 'Entrega', description: 'Indica la dirección de entrega.' },
  review: { title: 'Revisión', description: 'Revisa tus datos y productos antes de confirmar la compra.' },
  payment: { title: 'Pago', description: 'Elige un escenario del Payment Sandbox para simular el resultado de tu pago. No se procesará ningún pago real.' },
}

/** Mantiene Buyer, Delivery, consentimiento e intentos en memoria local; al desmontarse se pierde este contexto. */
function CheckoutPage({ onBackToCart, onCatalogClick, onCartClick, onNavigationLockChange, onOrderCreated }: CheckoutPageProps) {
  const { items, cleanupPurchase } = useCart()
  const [currentStep, setCurrentStep] = useState<CheckoutStep>('buyer')
  const [data, setData] = useState<CheckoutData>({ buyer: { fullName: '', email: '', phone: '' }, delivery: { province: '', canton: '', address: '', additionalInfo: '' } })
  const [order, setOrder] = useState<Order>()
  const [error, setError] = useState<string>()
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [termsAccepted, setTermsAccepted] = useState(false)
  const [termsError, setTermsError] = useState<string>()
  const [termsVersionRejected, setTermsVersionRejected] = useState(false)
  const [isTermsOpen, setIsTermsOpen] = useState(false)
  const termsInputRef = useRef<HTMLInputElement>(null)
  const [attempt, setAttempt] = useState<CreationAttempt>()
  const [differences, setDifferences] = useState<string[]>([])
  const [isCreatingOrder, setIsCreatingOrder] = useState(false)
  const [selectedPaymentScenario, setSelectedPaymentScenario] = useState<PaymentScenario | null>(null)
  const [isProcessingPayment, setIsProcessingPayment] = useState(false)
  const [hasPendingPayment, setHasPendingPayment] = useState(false)
  const [paymentError, setPaymentError] = useState<string>()
  // Último PaymentResult validado por paymentApi; es la fuente para decidir qué pantalla de
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
  const purchaseBaselineRef = useRef<{ orderId: string; items: CartItem[] } | undefined>(undefined)
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

    //Revisa si hay carrito vacío (EMPTY_CART)
  useEffect(() => {
    if (items.length === 0 && !order && !confirmed) {
      onBackToCart()
    }
  }, [items.length, order, confirmed, onBackToCart])
  
  useEffect(() => {
    // Confirmation y el panel de resultado administran el foco de sus propias vistas.
    if (confirmed || (currentStep === 'payment' && paymentResult)) return
    const frame = requestAnimationFrame(() => {
      const target = stageChangedRef.current ? stageHeadingRef.current : pageHeadingRef.current
      target?.focus({ preventScroll: true })
    })
    return () => cancelAnimationFrame(frame)
  }, [confirmed, currentStep, order, paymentResult])

  useEffect(() => {
    if (!termsError || currentStep !== 'review') return
    const frame = requestAnimationFrame(() => termsInputRef.current?.focus())
    return () => cancelAnimationFrame(frame)
  }, [termsError, currentStep])

  /** No permite cambiar el consentimiento de un intento ya capturado. */
  function changeTermsAccepted(accepted: boolean) {
    if (submittingRef.current || attemptRef.current || order || termsVersionRejected) return
    setTermsAccepted(accepted)
    if (accepted) setTermsError(undefined)
  }

  /** Cambia a la etapa solicitada si las guardas del intento y del pago permiten navegar. */
  function changeStep(next: CheckoutStep) {
    if (submittingRef.current || paymentSubmittingRef.current || confirmed) return
    if (next === 'payment' && !order) return
    if (attemptRef.current && next !== 'review' && next !== 'payment') return
    stageChangedRef.current = true
    setError(undefined)
    setCurrentStep(next)
  }

  /**
   * Desde Review captura una clave y consentimiento solo si no existe CreationAttempt.
   * Un fallo no concluyente conserva ambos para Retry; una Order ya recibida se reutiliza
   * al aceptar diferencias financieras, sin crear otra ni modificar su consentimiento.
   */
  async function confirmOrder() {
    if (submittingRef.current || paymentSubmittingRef.current || confirmed || (!order && invalid)) return
    if (order) {
      setDifferences([])
      onNavigationLockChange(false)
      changeStep('payment')
      return
    }
    if (!attemptRef.current && (!termsAccepted || termsVersionRejected)) {
      setTermsError(termsVersionRejected
        ? 'El servidor rechazó la versión de términos disponible. Debes revisar una versión actualizada antes de iniciar otra solicitud; esta pantalla no puede actualizarla automáticamente.'
        : 'Debes aceptar los Términos y Condiciones para continuar con tu compra.')
      termsInputRef.current?.focus()
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
          termsAcceptance: Object.freeze({ accepted: true, version: termsPolicy.version }),
        },
        items: items.map(item => ({ ...item })),
      }
      attemptRef.current = activeAttempt
      setAttempt(activeAttempt)
      const created = await orderApi.createOrder(activeAttempt.request)
      const alreadyConfirmed = created.orderStatus === 'CONFIRMED' && created.paymentStatus === 'APPROVED'
      purchaseBaselineRef.current = alreadyConfirmed ? undefined : { orderId: created.id, items: activeAttempt.items }
      const changes = alreadyConfirmed ? [] : orderReviewDifferences(activeAttempt.items, created)
      requiresAcceptance = changes.length > 0
      setDifferences(changes)
      setOrder(created)
      onOrderCreated()
      attemptRef.current = undefined
      setAttempt(undefined)
      stageChangedRef.current = true
      setCurrentStep(alreadyConfirmed || requiresAcceptance ? 'review' : 'payment')
      // El ref protege incluso clicks ocurridos antes del siguiente render de React.
      submittingRef.current = true
      setIsCreatingOrder(true)
      onNavigationLockChange(true)
      setError(undefined)
      setFieldErrors({}) // Descarta errores de campo tras recibir la Order.
      setTermsError(undefined)
    } catch (failure) {
      if (failure instanceof OrderApiError) {
        if (failure.conclusive) {
          attemptRef.current = undefined
          setAttempt(undefined)
        }
        // Si el servidor nos devuelve errores de validación precisos
        if (failure.code === 'CHECKOUT_VALIDATION_ERROR' && failure.fieldErrors) {
           const versionError = Object.hasOwn(failure.fieldErrors, 'termsAcceptance.version')
           if (versionError || Object.hasOwn(failure.fieldErrors, 'termsAcceptance.accepted')) {
             if (failure.conclusive) {
               setTermsAccepted(false)
               if (versionError) setTermsVersionRejected(true)
             }
             setCurrentStep('review')
             setTermsError(failure.conclusive
               ? versionError
                 ? 'El servidor rechazó la versión de términos disponible. Debes revisar una versión actualizada antes de iniciar otra solicitud; esta pantalla no puede actualizarla automáticamente.'
                 : 'Debes aceptar los Términos y Condiciones para continuar con tu compra.'
               : 'No se pudo confirmar la aceptación de términos. Reintentar conserva la misma solicitud y su versión original.')
             return
           }
           setFieldErrors(failure.fieldErrors) // Conserva los errores por campo para mostrarlos en el formulario.
           setCurrentStep('buyer') 
        }
      }
      setError(orderErrorMessage(failure))
    } finally {
      submittingRef.current = false
      setIsCreatingOrder(false)
      onNavigationLockChange(Boolean(attemptRef.current) || requiresAcceptance)
    }
  }

  /** Selecciona el escenario solicitado solo cuando no existe un intento pendiente ni un resultado cerrado. */
  function changePaymentScenario(scenario: PaymentScenario) {
    if (paymentSubmittingRef.current || paymentAttemptRef.current || paymentResultRef.current || confirmed) return
    setSelectedPaymentScenario(scenario)
  }

  /** Procesa el escenario con una identidad estable; actualiza la Order y limpia unidades originales solo ante aprobación válida. */
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

      // Solo el cierre iniciado aquí puede retirar las unidades originales todavía presentes.
      const baseline = purchaseBaselineRef.current
      if (result.result === 'PAYMENT_APPROVED' && result.order.orderStatus === 'CONFIRMED'
        && result.order.paymentStatus === 'APPROVED' && baseline?.orderId === result.order.id
        && !cartClearedRef.current) {
        cartClearedRef.current = true
        cleanupPurchase({ baseline: baseline.items, purchased: result.order.items })
      }
    } catch (failure) {
      setPaymentError(paymentErrorMessage(failure))
    } finally {
      paymentSubmittingRef.current = false
      setIsProcessingPayment(false)
      onNavigationLockChange(false)
    }
  }

  /** Prepara otro intento sobre la misma Order tras Declined o Error y exige volver a elegir escenario. */
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

  /** Vuelve al carrito si no hay una operación en curso; no cancela la Order ni modifica sus productos. */
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
  // pudo conservar nuevas incorporaciones): Confirmation nunca depende de CartState para renderizarse.
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
                onContinue={buyer => { setData(current => ({ ...current, buyer })); changeStep('delivery') }} 
                onBack={onBackToCart} 
                errors={fieldErrors} />
            ) : currentStep === 'delivery' ? (
              <DeliveryStep value={data.delivery} onChange={delivery => setData(current => ({ ...current, delivery }))}
                onContinue={delivery => { setData(current => ({ ...current, delivery })); changeStep('review') }} 
                onBack={() => changeStep('buyer')} 
                errors={fieldErrors} />
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
                  termsAccepted={attempt?.request.termsAcceptance.accepted ?? termsAccepted}
                  termsError={termsError} termsVersionRejected={termsVersionRejected} termsInputRef={termsInputRef}
                  onTermsAcceptedChange={changeTermsAccepted} onOpenTerms={() => setIsTermsOpen(true)}
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
      {isTermsOpen ? <TermsDialog onClose={() => setIsTermsOpen(false)} versionRejected={termsVersionRejected} /> : null}
    </div>
  )
}
export default CheckoutPage
