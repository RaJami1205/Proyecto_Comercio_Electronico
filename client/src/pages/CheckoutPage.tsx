import { useEffect, useRef, useState } from 'react'
import CheckoutStepper, { type CheckoutStep } from '../components/checkout/CheckoutStepper'
import BuyerStep from '../components/checkout/BuyerStep'
import DeliveryStep from '../components/checkout/DeliveryStep'
import ReviewStep from '../components/checkout/ReviewStep'
import type { CheckoutData } from '../types/checkout'
import type { CreateOrderRequest, Order } from '../types/order'
import type { CartItem } from '../types/cart'
import { useCart } from '../hooks/useCart'
import { calculateCartTotals, calculateLineSubtotal } from '../utils/cartCalculations'
import { normalizeBuyer, normalizeDelivery, validateBuyer, validateDelivery } from '../utils/checkoutValidation'
import { orderApi, OrderApiError, orderErrorMessage } from '../services/orderApi'
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
const stages: Record<CheckoutStep, { title: string; description: string }> = {
  buyer: { title: 'Comprador', description: 'Completa tus datos de contacto.' },
  delivery: { title: 'Entrega', description: 'Indica la dirección de entrega.' },
  review: { title: 'Revisión', description: 'Revisa tus datos y productos antes de confirmar la compra.' },
  payment: { title: 'Pago', description: 'Tu orden está pendiente. La etapa de pago estará disponible próximamente. No se procesará un pago desde esta pantalla.' },
}

/** Buyer, Delivery, intento y Order viven exclusivamente dentro de este Checkout. */
function CheckoutPage({ onBackToCart, onCatalogClick, onCartClick, onNavigationLockChange, onOrderCreated }: CheckoutPageProps) {
  const { items } = useCart()
  const [currentStep, setCurrentStep] = useState<CheckoutStep>('buyer')
  const [data, setData] = useState<CheckoutData>({ buyer: { fullName: '', email: '', phone: '' }, delivery: { province: '', canton: '', address: '', additionalInfo: '' } })
  const [order, setOrder] = useState<Order>()
  const [differences, setDifferences] = useState<string[]>([])
  const [isCreatingOrder, setIsCreatingOrder] = useState(false)
  const [error, setError] = useState<string>()
  const [attempt, setAttempt] = useState<CreationAttempt>()
  const attemptRef = useRef<CreationAttempt | undefined>(undefined)
  const submittingRef = useRef(false)
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
    const frame = requestAnimationFrame(() => {
      const target = stageChangedRef.current ? stageHeadingRef.current : pageHeadingRef.current
      target?.focus({ preventScroll: true })
    })
    return () => cancelAnimationFrame(frame)
  }, [currentStep, order])

  function changeStep(next: CheckoutStep) {
    if (submittingRef.current || confirmed) return
    if (next === 'payment' && !order) return
    if (attemptRef.current && next !== 'review' && next !== 'payment') return
    stageChangedRef.current = true
    setError(undefined)
    setCurrentStep(next)
  }

  async function confirmOrder() {
    if (submittingRef.current || confirmed || (!order && invalid)) return
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

  function abandonCheckout() {
    if (submittingRef.current) return
    // La salida es explícita: no cancela ni recrea la Order y no modifica Cart.
    onNavigationLockChange(false)
    onBackToCart()
  }

  const displayItems = order?.items ?? reviewItems.map(item => ({ productId: item.productId, name: item.name, image: item.image, unitPrice: item.price, quantity: item.quantity, lineSubtotal: calculateLineSubtotal(item.price, item.quantity) }))
  const lockNavigation = isCreatingOrder || Boolean(attempt) || differences.length > 0
  return (
    <div className={styles.page}>
      <div inert={lockNavigation}><Header checkoutView onCartClick={onCartClick} onCatalogClick={onCatalogClick} /></div>
      <main className={styles.main}>
        <div className={styles.container}>
          <p className={styles.eyebrow}>Tu compra, paso a paso</p>
          <h1 ref={pageHeadingRef} tabIndex={-1} data-app-heading>Finalizar compra</h1>
          <CheckoutStepper currentStep={currentStep} />
          <section className={styles.stage} aria-labelledby="checkout-stage-title" aria-busy={isCreatingOrder}>
            <h2 id="checkout-stage-title" ref={stageHeadingRef} tabIndex={-1}>{stage.title}</h2>
            <p>{stage.description}</p>
            {currentStep === 'buyer' ? (
              <BuyerStep value={data.buyer} onChange={buyer => setData(current => ({ ...current, buyer }))}
                onContinue={buyer => { setData(current => ({ ...current, buyer })); changeStep('delivery') }} onBack={onBackToCart} />
            ) : currentStep === 'delivery' ? (
              <DeliveryStep value={data.delivery} onChange={delivery => setData(current => ({ ...current, delivery }))}
                onContinue={delivery => { setData(current => ({ ...current, delivery })); changeStep('review') }} onBack={() => changeStep('buyer')} />
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
                  {currentStep === 'payment' ? <button type="button" className={styles.back} onClick={() => changeStep('review')}>Revisar orden</button> : null}
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
