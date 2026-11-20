/** Coordina las etapas de Checkout, la creación de Order, los intentos de pago y el cierre de compra. */
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
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
import type { TransactionState } from '../context/SessionContext'
import type { BranchId } from '../types/branch'
import { useCart } from '../hooks/useCart'
import { useBranch } from '../hooks/useBranch'
import { calculateCartTotals, calculateLineSubtotal } from '../utils/cartCalculations'
import { commercialIssues, normalizeBuyer, normalizeDelivery, validateBuyer, validateDelivery } from '../utils/checkoutValidation'
import { classifyOrderFailure, orderApi, OrderApiError, orderErrorMessage, type CheckoutRecovery } from '../services/orderApi'
import { paymentApi, PaymentApiError, paymentErrorMessage } from '../services/paymentApi'
import { orderHistoryApi } from '../services/orderHistoryApi'
import { orderReviewDifferences } from '../utils/orderReviewDifferences'
import Header from '../components/layout/Header'
import Footer from '../components/layout/Footer'
import styles from '../styles/pages/CheckoutPage.module.css'
import { trackEvent } from '../services/analytics'
import { useSession } from '../hooks/useSession'

interface CheckoutPageProps {
  onBackToCart: () => void
  onCatalogClick: (hash?: '#top' | '#catalog') => void
  onCartClick: () => void
  onNavigationLockChange: (busy: boolean) => void
  onOrderCreated: () => void
  onTransactionStateChange: (state: TransactionState) => void
  purchaseBlockedReason?: string | null
  getPurchaseBlockReason?: () => string | null
}
/** Conserva payload, clave y productos revisados para repetir la misma intención tras una respuesta ambigua. */
interface CreationAttempt { request: CreateOrderRequest; items: CartItem[]; userId: string }
type PaymentAttempt = Readonly<ProcessPaymentRequest & { orderId: string; userId: string }>
const stages: Record<CheckoutStep, { title: string; description: string }> = {
  buyer: { title: 'Comprador', description: 'Completa tus datos de contacto.' },
  delivery: { title: 'Entrega', description: 'Indica la dirección de entrega.' },
  review: { title: 'Revisión', description: 'Revisa tus datos y productos antes de confirmar la compra.' },
  payment: { title: 'Pago', description: 'Elige un escenario del Payment Sandbox para simular el resultado de tu pago. No se procesará ningún pago real.' },
}

/** Mantiene Buyer, Delivery, consentimiento e intentos en memoria local; al desmontarse se pierde este contexto. */
function CheckoutPage({ onBackToCart, onCatalogClick, onCartClick, onNavigationLockChange, onOrderCreated, onTransactionStateChange, purchaseBlockedReason, getPurchaseBlockReason }: CheckoutPageProps) {
  const { items, cleanupPurchase, ownerId: cartOwnerId } = useCart()
  const { user, epoch } = useSession()
  const { branches, selectedBranchId } = useBranch()
  // ADMIN y la ausencia de Session nunca habilitan compras; el Server vuelve a validar el rol.
  const purchaser = user && user.role !== 'ADMIN' ? user : undefined
  const currentSession = useRef({ userId: user?.id, epoch })
  useLayoutEffect(() => { currentSession.current = { userId: user?.id, epoch } }, [user?.id, epoch])
  const originalSession = useRef({ userId: user?.id, epoch })
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const [authorizationRejected, setAuthorizationRejected] = useState(false)
  const authorizationRejectedRef = useRef(false)
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
  // Destino sugerido para corregir un rechazo concluyente sin reiniciar el Checkout.
  const [recovery, setRecovery] = useState<CheckoutRecovery>()
  const [isCreatingOrder, setIsCreatingOrder] = useState(false)
  const [selectedPaymentScenario, setSelectedPaymentScenario] = useState<PaymentScenario | null>(null)
  const [isProcessingPayment, setIsProcessingPayment] = useState(false)
  const [hasPendingPayment, setHasPendingPayment] = useState(false)
  const [confirmedOrderRecovery, setConfirmedOrderRecovery] = useState(false)
  const [paymentError, setPaymentError] = useState<string>()
  // Último PaymentResult validado por paymentApi; es la fuente para decidir qué pantalla de
  // resultado mostrar (CN-32). Se limpia al pedir un Retry, lo que vuelve a mostrar el form.
  const [paymentResult, setPaymentResult] = useState<PaymentResult>()
  const attemptRef = useRef<CreationAttempt | undefined>(undefined)
  const submittingRef = useRef(false)
  const paymentAttemptRef = useRef<PaymentAttempt | undefined>(undefined)
  const confirmedOrderRecoveryRef = useRef(false)
  const paymentSubmittingRef = useRef(false)
  const paymentResultRef = useRef<PaymentResult | undefined>(undefined)
  // Garantiza que el Cart se limpie una sola vez por confirmación (CN-33), incluso si
  // algo disparara un re-render extra del mismo resultado APPROVED.
  const cartClearedRef = useRef(false)
  const purchaseBaselineRef = useRef<{ orderId: string; ownerId: string; items: CartItem[] } | undefined>(undefined)
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

  /** Impide aplicar respuestas de otra Session o de una instancia de Checkout desmontada. */
  function isCurrentSession() {
    return mounted.current && currentSession.current.userId === originalSession.current.userId
      && currentSession.current.epoch === originalSession.current.epoch
  }

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
    if (submittingRef.current || paymentSubmittingRef.current || confirmed || confirmedOrderRecoveryRef.current) return
    if (next === 'payment' && !order) return
    if (attemptRef.current && next !== 'review' && next !== 'payment') return
    stageChangedRef.current = true
    if (!authorizationRejectedRef.current) setError(undefined)
    setCurrentStep(next)
  }

  /**
   * Desde Review captura una clave y consentimiento solo si no existe CreationAttempt.
   * Un fallo no concluyente conserva ambos para Retry; una Order ya recibida se reutiliza
   * al aceptar diferencias financieras, sin crear otra ni modificar su consentimiento.
   */
  async function confirmOrder() {
    if (!isCurrentSession() || authorizationRejectedRef.current || confirmedOrderRecoveryRef.current || !purchaser) return
    const retryingUncertain = Boolean(attemptRef.current)
    if (submittingRef.current || paymentSubmittingRef.current || confirmed || (!order && invalid)) return
    const blockedReason = getPurchaseBlockReason?.() ?? purchaseBlockedReason
    if (!order && !attemptRef.current && blockedReason) { setError(blockedReason); return }
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
    // Un intento existente conserva usuario, sucursal, payload y clave; solo un intento nuevo se prevalida.
    let activeAttempt = attemptRef.current
    if (!activeAttempt) {
      if (cartOwnerId !== purchaser.id) {
        setError('Este carrito pertenece a otra identidad. Selecciona su propietario antes de comprar.')
        setRecovery('cart')
        return
      }
      const branchId = selectedBranchId
      if (!branchId || !branches.some(branch => branch.id === branchId && branch.available)) {
        setError('Selecciona una sucursal válida en el carrito antes de confirmar la compra.')
        setRecovery('cart')
        return
      }
      const issues = commercialIssues(items, purchaser.role, branchId)
      if (issues.length > 0) {
        setError('Ajusta tu carrito antes de continuar. ' + issues.map(issue => issue.message).join(' '))
        setRecovery('cart')
        return
      }
      activeAttempt = {
        userId: purchaser.id,
        request: {
          buyer: normalizeBuyer(data.buyer), delivery: normalizeDelivery(data.delivery),
          items: items.map(({ productId, quantity }) => ({ productId, quantity })),
          idempotencyKey: crypto.randomUUID(),
          termsAcceptance: Object.freeze({ accepted: true, version: termsPolicy.version }),
          branchId,
          // Estimación del Client; el Server la compara y rechaza el intento si los importes cambiaron.
          financialExpectation: Object.freeze(calculateCartTotals(items)),
        },
        items: items.map(item => ({ ...item })),
      }
    }
    // El ref protege incluso clicks ocurridos antes del siguiente render de React.
    submittingRef.current = true
    setIsCreatingOrder(true)
    onNavigationLockChange(true)
    onTransactionStateChange('active')
    setError(undefined)
    setRecovery(undefined)
    let requiresAcceptance = false
    let receivedOrder = false
    try {
      attemptRef.current = activeAttempt
      setAttempt(activeAttempt)
      const created = await orderApi.createOrder(activeAttempt.request, activeAttempt.userId)
      if (!isCurrentSession()) return
      receivedOrder = true
      const alreadyConfirmed = created.orderStatus === 'CONFIRMED' && created.paymentStatus === 'APPROVED'
      purchaseBaselineRef.current = alreadyConfirmed ? undefined : { orderId: created.id, ownerId: activeAttempt.userId, items: activeAttempt.items }
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
      if (!isCurrentSession()) return
      if (failure instanceof OrderApiError) {
        if (failure.authorizationDenied && !retryingUncertain) {
          authorizationRejectedRef.current = true
          setAuthorizationRejected(true)
        }
        if (failure.conclusive && !(retryingUncertain && failure.authorizationDenied)) {
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
           const target = classifyOrderFailure(failure).recovery
           if (target === 'buyer' || target === 'delivery') {
             setFieldErrors(failure.fieldErrors) // Conserva los errores por campo para mostrarlos en el formulario.
             setCurrentStep(target)
           }
        }
        // Precio, MOQ, inventario o sucursal se corrigen en el carrito; el intento ya fue descartado.
        if (failure.conclusive && !attemptRef.current && classifyOrderFailure(failure).recovery === 'cart') setRecovery('cart')
      }
      setError(failure instanceof OrderApiError && failure.authorizationDenied && retryingUncertain
        ? orderErrorMessage(failure) + ' El resultado anterior sigue incierto. Reintentar conserva la misma solicitud.'
        : orderErrorMessage(failure))
    } finally {
      if (isCurrentSession()) {
        submittingRef.current = false
        setIsCreatingOrder(false)
        onNavigationLockChange(Boolean(attemptRef.current) || requiresAcceptance)
        onTransactionStateChange(attemptRef.current ? 'uncertain' : receivedOrder || order ? 'known' : 'idle')
      }
    }
  }

  /** Selecciona el escenario solicitado solo cuando no existe un intento pendiente ni un resultado cerrado. */
  function changePaymentScenario(scenario: PaymentScenario) {
    if (paymentSubmittingRef.current || paymentAttemptRef.current || paymentResultRef.current || confirmed || confirmedOrderRecoveryRef.current) return
    setSelectedPaymentScenario(scenario)
  }

  /** Recupera solo el estado de la misma Order propia; una consulta nunca constituye un PaymentResult. */
  async function recoverConfirmedOrder(activeAttempt: PaymentAttempt) {
    try {
      const recovered = await orderHistoryApi.getOrder(activeAttempt.userId, activeAttempt.orderId, AbortSignal.timeout(20000))
      if (!isCurrentSession()) return
      if (recovered.orderStatus !== 'CONFIRMED' || recovered.paymentStatus !== 'APPROVED'
        || recovered.commercial?.branchId !== order?.commercial?.branchId) throw new Error('Estado de Order insuficiente.')
      setOrder(recovered)
      paymentAttemptRef.current = undefined
      setHasPendingPayment(false)
      setDifferences([])
    } catch {
      if (isCurrentSession()) setPaymentError('El servidor indicó que la orden ya estaba confirmada, pero no pudimos verificar su estado. Reintenta la consulta; no se enviará otro pago.')
    }
  }

  /** Procesa el escenario con una identidad estable; actualiza la Order y limpia unidades originales solo ante aprobación válida. */
  async function handleProcessPayment() {
    if (!isCurrentSession() || authorizationRejectedRef.current || !purchaser) return
    const retryingUncertain = Boolean(paymentAttemptRef.current)
    // Guarda de doble-submit / múltiples Retry concurrentes: el ref cubre clicks antes
    // del siguiente render; isProcessingPayment refleja el bloqueo en la UI.
    if (paymentSubmittingRef.current || submittingRef.current || paymentResultRef.current || confirmed || !order || !selectedPaymentScenario) return
    // Incluso un callback anterior a la recuperación no puede iniciar otro Payment.
    if (confirmedOrderRecoveryRef.current && !paymentAttemptRef.current) return

    paymentSubmittingRef.current = true
    setIsProcessingPayment(true)
    setPaymentError(undefined)
    onNavigationLockChange(true)
    onTransactionStateChange('active')

    try {
      const activeAttempt = paymentAttemptRef.current ?? Object.freeze({
        orderId: order.id, scenario: selectedPaymentScenario, idempotencyKey: crypto.randomUUID(), userId: purchaser.id,
      })
      paymentAttemptRef.current = activeAttempt
      setHasPendingPayment(true)
      if (confirmedOrderRecoveryRef.current) {
        await recoverConfirmedOrder(activeAttempt)
        return
      }
      const result = await paymentApi.processPayment(activeAttempt.orderId, activeAttempt, activeAttempt.userId)
      if (!isCurrentSession()) return
      // Resultado concluyente (APPROVED/DECLINED/ERROR): el intento queda cerrado,
      // así que el próximo "Procesar pago"/Retry debe generar una idempotencyKey nueva.
      paymentAttemptRef.current = undefined
      setHasPendingPayment(false)
      paymentResultRef.current = result
      // La Order que viene en la respuesta reemplaza por completo el snapshot anterior;
      // nunca inferimos o simulamos orderStatus/paymentStatus en el Client.
      setOrder(result.order)
      setPaymentResult(result)

      if (result.result === 'PAYMENT_APPROVED' && result.order.orderStatus === 'CONFIRMED'
        && result.order.paymentStatus === 'APPROVED' && result.order.id.trim()) {
        /** El resultado aprobado y la Order confirmada habilitan el evento. El Core usa el Order ID para deduplicar Retry y Replay. */
        trackEvent({ type: 'PURCHASE_COMPLETED', occurredAt: result.processedAt, metadata: { orderId: result.order.id } }, user?.id)
      }

      // Solo el cierre iniciado aquí puede retirar las unidades originales todavía presentes.
      const baseline = purchaseBaselineRef.current
      if (result.result === 'PAYMENT_APPROVED' && result.order.orderStatus === 'CONFIRMED'
        && result.order.paymentStatus === 'APPROVED' && baseline?.orderId === result.order.id
        && !cartClearedRef.current) {
        cartClearedRef.current = true
        cleanupPurchase({ baseline: baseline.items, purchased: result.order.items, ownerId: baseline.ownerId })
      }
    } catch (failure) {
      if (!isCurrentSession()) return
      if (failure instanceof PaymentApiError && failure.conclusive && failure.code === 'ORDER_ALREADY_CONFIRMED'
        && paymentAttemptRef.current) {
        confirmedOrderRecoveryRef.current = true
        setConfirmedOrderRecovery(true)
        setCurrentStep('payment')
        await recoverConfirmedOrder(paymentAttemptRef.current)
        return
      }
      if (failure instanceof PaymentApiError && failure.authorizationDenied && !retryingUncertain) {
        paymentAttemptRef.current = undefined
        setHasPendingPayment(false)
        authorizationRejectedRef.current = true
        setAuthorizationRejected(true)
        setError(paymentErrorMessage(failure))
      }
      setPaymentError(failure instanceof PaymentApiError && failure.authorizationDenied && retryingUncertain
        ? paymentErrorMessage(failure) + ' El resultado anterior sigue incierto. Reintentar conserva la misma solicitud.'
        : paymentErrorMessage(failure))
    } finally {
      if (isCurrentSession()) {
        paymentSubmittingRef.current = false
        setIsProcessingPayment(false)
        onNavigationLockChange(false)
        onTransactionStateChange(paymentAttemptRef.current ? 'uncertain' : 'known')
      }
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
    if (submittingRef.current || paymentSubmittingRef.current || attemptRef.current || paymentAttemptRef.current) {
      setError('Resuelve el intento pendiente antes de salir de Checkout. Reintentar conserva la misma solicitud.')
      return
    }
    // La salida es explícita: no cancela ni recrea la Order y no modifica Cart.
    onNavigationLockChange(false)
    onTransactionStateChange('idle')
    onBackToCart()
  }

  // CN-33: a partir de aquí existe una Order CONFIRMED/APPROVED. Se presenta la vista
  // dedicada de Confirmation en vez del layout de Checkout — ya no hay stepper, ya no
  // hay forma de volver a Payment, y "Volver al catálogo" reemplaza cualquier acción
  // de edición. La Order sigue viva en este mismo state, independiente del Cart (que
  // pudo conservar nuevas incorporaciones): Confirmation nunca depende de CartState para renderizarse.
  if (confirmed && order) {
    return <OrderConfirmationPage order={order} recovered={confirmedOrderRecovery} onCatalogClick={onCatalogClick} onCartClick={onCartClick} />
  }

  const displayItems = order?.items ?? reviewItems.map(item => ({ productId: item.productId, name: item.name, image: item.image, unitPrice: item.price, quantity: item.quantity, lineSubtotal: calculateLineSubtotal(item.price, item.quantity), minOrderQuantity: item.minimumOrderQuantity }))
  // Tras crear la Order se presenta su contexto comercial confirmado; antes, la identidad y sucursal vigentes.
  const reviewBranchId: BranchId | null = order?.commercial?.branchId ?? attempt?.request.branchId ?? selectedBranchId
  const commercialSummary = purchaser ? {
    displayName: purchaser.displayName,
    customerRole: order?.commercial?.customerRole ?? purchaser.role,
    companyName: order?.commercial ? order.commercial.company?.name : purchaser.role === 'B2B' ? purchaser.company.name : undefined,
    branchName: reviewBranchId ? branches.find(branch => branch.id === reviewBranchId)?.name ?? reviewBranchId : undefined,
    confirmedByServer: Boolean(order?.commercial),
  } : undefined
  const lockNavigation = isCreatingOrder || isProcessingPayment || Boolean(attempt) || differences.length > 0
  return (
    <div className={styles.page}>
      <div inert={lockNavigation}><Header checkoutView onCartClick={onCartClick} onCatalogClick={onCatalogClick} /></div>
      <main className={styles.main}>
        <div className={styles.container}>
          <p className={styles.eyebrow}>Tu compra, paso a paso</p>
          <h1 ref={pageHeadingRef} tabIndex={-1} data-app-heading>Finalizar compra</h1>
          <CheckoutStepper currentStep={currentStep} />
          {purchaseBlockedReason ? <p role="status">{purchaseBlockedReason} Los intentos ya capturados conservan su Retry.</p> : null}
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
                {confirmedOrderRecovery ? (
                  <div>
                    <p role={paymentError ? 'alert' : 'status'}>{paymentError ?? 'Consultando el estado de la orden ya confirmada…'}</p>
                    <button type="button" className={styles.back} disabled={isProcessingPayment} onClick={handleProcessPayment}>
                      {isProcessingPayment ? 'Consultando orden…' : 'Recuperar estado de la orden'}
                    </button>
                  </div>
                ) : paymentResult ? (
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
                    locked={confirmed || authorizationRejected}
                    scenarioLocked={hasPendingPayment}
                    error={paymentError}
                  />
                )}
                <div className={styles.actions}>
                  <button type="button" className={styles.back} disabled={isProcessingPayment || confirmedOrderRecovery} onClick={() => changeStep('review')}>Revisar orden</button>
                </div>
              </>
            ) : (
              <>
                <ReviewStep buyer={order?.buyer ?? data.buyer} delivery={order?.delivery ?? data.delivery}
                  items={displayItems} totals={order?.totals ?? calculateCartTotals(reviewItems)} order={order}
                  busy={isCreatingOrder} retryPending={Boolean(attempt)} invalid={!order && invalid} authorizationRejected={authorizationRejected} error={error}
                  differences={differences} commercial={commercialSummary}
                  onAdjustCart={recovery === 'cart' && !order && !attempt && !isCreatingOrder ? onBackToCart : undefined}
                  termsAccepted={attempt?.request.termsAcceptance.accepted ?? termsAccepted}
                  termsError={termsError} termsVersionRejected={termsVersionRejected} termsInputRef={termsInputRef}
                  onTermsAcceptedChange={changeTermsAccepted} onOpenTerms={() => setIsTermsOpen(true)}
                  onAbandon={order && !hasPendingPayment ? abandonCheckout : undefined}
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
