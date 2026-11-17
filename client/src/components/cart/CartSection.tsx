/** Conecta la presentación del Cart con useCart y los cálculos financieros derivados. */
import { useEffect, useMemo, useState, type MouseEvent } from 'react'

import { useCart } from '../../hooks/useCart'
import { useSession } from '../../hooks/useSession'
import { calculateCartTotals, calculateLineSubtotal } from '../../utils/cartCalculations'
import styles from '../../styles/cart/CartSection.module.css'
import BranchSelector from '../catalog/BranchSelector'
import { useBranch } from '../../hooks/useBranch'
import { getProductsByIds } from '../../services/productApi'
import type { Product } from '../../types/product'

interface CartSectionProps {
  onContinueShopping: () => void
  onCheckoutRequested: () => void
  onProductSelect: (product: Product) => void
}

const priceFormatter = new Intl.NumberFormat('es-CR', {
  style: 'currency',
  currency: 'CRC',
  maximumFractionDigits: 0,
})

/** Presenta líneas, controles y resumen, o el Empty State cuando no hay items. */
function CartSection({ onContinueShopping, onCheckoutRequested, onProductSelect }: CartSectionProps) {
  const { purchaseBlockReason, openLogin, user } = useSession()
  const { items, incrementItem, decrementItem, removeItem, totalUnits, ownerId, isActive, hasExternalConflict,
    hasInvalidStorage, updateProductContext } = useCart()
  const { selectedBranchId } = useBranch()
  const [productContext, setProductContext] = useState<{ key: string; products: Map<string, Product>; error: string | null }>({ key: '', products: new Map(), error: null })
  const itemIds = useMemo(() => items.map(item => item.productId).sort(), [items])
  const contextKey = `${user?.id ?? 'anonymous'}:${selectedBranchId ?? 'no-branch'}:${itemIds.join(',')}`

  useEffect(() => {
    if (itemIds.length === 0) return
    let cancelled = false
    void getProductsByIds(itemIds, user?.id, selectedBranchId).then(products => {
      if (cancelled) return
      const byId = new Map(products.map(product => [product.id, product]))
      for (const product of products) updateProductContext(product.id, {
        ...(product.price !== null ? { price: product.price } : {}), retailPrice: product.retailPrice,
        pricingType: product.pricing.type, minimumOrderQuantity: product.pricing.minOrderQuantity ?? 1,
        branchId: product.inventory.branchId, availableQuantity: product.inventory.quantity,
        inventoryStatus: product.inventory.status, commercialEligible: product.pricing.eligible && product.price !== null,
      })
      setProductContext({ key: contextKey, products: byId, error: null })
    }).catch(() => {
      if (!cancelled) setProductContext({ key: contextKey, products: new Map(), error: 'No pudimos actualizar precios y existencias. Reintenta la validación antes de continuar.' })
    })
    return () => { cancelled = true }
  }, [contextKey, itemIds, user?.id, selectedBranchId, updateProductContext])

  const contextReady = items.length === 0 || productContext.key === contextKey
  const contextError = contextReady ? productContext.error : null
  const contextualItems = items.map(item => ({ item, product: productContext.key === contextKey ? productContext.products.get(item.productId) : undefined }))
  const unresolved = contextualItems.some(({ product }) => !product || product.price === null || !product.pricing.eligible)
  const conflicts = contextualItems.some(({ item, product }) => !product || product.inventory.status !== 'available'
    || product.inventory.quantity === null || item.quantity > product.inventory.quantity
    || !product.inventory.canFulfillMinimum || item.quantity < (product.pricing.minOrderQuantity ?? 1))
  const commercialItems = contextualItems.flatMap(({ item, product }) => product?.price !== null && product?.price !== undefined
    ? [{ ...item, price: product.price }] : [])
  const { subtotal, tax, shipping, total } = calculateCartTotals(commercialItems)
  const checkoutBlock = purchaseBlockReason || (!isActive ? 'Este carrito está guardado para otra identidad. Selecciona su propietario para usarlo.'
    : hasExternalConflict || hasInvalidStorage ? 'Resuelve el conflicto del carrito antes de continuar.'
      : !selectedBranchId ? 'Selecciona una sucursal para validar disponibilidad.'
        : contextError || (!contextReady ? 'Actualizando precios y existencias…' : unresolved ? 'Hay productos sin un precio comercial vigente.'
          : conflicts ? 'Ajusta cantidades o selecciona una sucursal con disponibilidad suficiente.' : null))

  /** Delega el regreso al catálogo sin provocar la navegación nativa del ancla. */
  function handleContinueShopping(event: MouseEvent<HTMLAnchorElement>) {
    event.preventDefault()
    onContinueShopping()
  }

  return (
    <section className={styles.section} id="cart" aria-labelledby="cart-title">
      <div className={styles.container}>
        <BranchSelector />
        <header className={styles.introduction}>
          <div>
            <p className={styles.eyebrow}>Tu selección</p>
            <h2 id="cart-title" tabIndex={-1} data-app-heading>Tu carrito</h2>
          </div>
          <p className={styles.description}>
            Revisa tus productos y ajusta las cantidades antes de continuar.
          </p>
        </header>

        {!isActive && ownerId ? <p role="status">Este carrito pertenece a otra identidad. Selecciona ese usuario para reactivarlo; sus productos permanecen guardados.</p> : null}
        {hasInvalidStorage ? <p role="alert">El carrito guardado no se pudo validar. Revísalo desde el selector de identidad antes de reemplazarlo.</p> : null}
        {!isActive && ownerId ? (
          <div className={styles.emptyState} role="status">
            <h3>Carrito guardado</h3>
            <p>Selecciona la identidad propietaria para volver a ver sus productos.</p>
            <button className={styles.identityButton} type="button" onClick={openLogin}>Seleccionar identidad</button>
          </div>
        ) : items.length === 0 ? (
          <div className={styles.emptyState}>
            <div className={styles.emptyIcon} aria-hidden="true">
              <svg viewBox="0 0 48 48">
                <path d="M7 9h5l5.1 22.2a4 4 0 0 0 3.9 3.1h17.4a4 4 0 0 0 3.8-2.8L46 17H15" />
                <circle cx="21" cy="41" r="2.5" />
                <circle cx="37" cy="41" r="2.5" />
              </svg>
            </div>
            <h3>Tu carrito está vacío</h3>
            <p>Explora el catálogo y agrega los productos que te interesan.</p>
            <a href="#catalog" onClick={handleContinueShopping}>
              Ir al catálogo
            </a>
          </div>
        ) : (
          <div className={styles.cartLayout}>
            <div className={styles.itemList} role="list" aria-label="Productos en el carrito">
              {items.map((item) => {
                const product = productContext.key === contextKey ? productContext.products.get(item.productId) : undefined
                const unitPrice = product?.price ?? null
                const itemSubtotal = unitPrice === null ? null : calculateLineSubtotal(unitPrice, item.quantity)
                const minimum = product?.pricing.minOrderQuantity ?? item.minimumOrderQuantity ?? 1

                return (
                  <article className={styles.item} key={item.productId} role="listitem">
                    <div className={styles.imagePanel}>
                      {product ? <button className={styles.productImageButton} type="button" aria-label={`Ver detalles de ${item.name}`} onClick={() => onProductSelect(product)}><img src={item.image} alt="" loading="lazy" /></button> : <img src={item.image} alt="" loading="lazy" />}
                    </div>

                    <div className={styles.itemDetails}>
                      <div className={styles.itemHeading}>
                        <div>
                          <h3>{product ? <button className={styles.productNameButton} type="button" onClick={() => onProductSelect(product)}>{item.name}</button> : item.name}</h3>
                          <p className={styles.unitPrice}>
                            {unitPrice === null ? 'Validando precio…' : `Precio unitario ${product?.pricing.type === 'WHOLESALE' ? 'B2B' : 'público'}: ${priceFormatter.format(unitPrice)}`}
                          </p>
                          {product?.pricing.type === 'WHOLESALE' ? <p className={styles.unitPrice}>Cantidad mínima: {minimum}</p> : null}
                          {product ? <p className={styles.unitPrice} role="status">{product.inventory.message}</p> : null}
                          {item.quantity < minimum ? <p className={styles.unitPrice} role="alert">Pedido mínimo: {minimum} unidades para este precio comercial.</p> : null}
                          {product?.inventory.quantity !== null && product && item.quantity > product.inventory.quantity ? <p className={styles.unitPrice} role="alert">Solo hay {product.inventory.quantity} unidades disponibles en esta sucursal.</p> : null}
                          {product?.pricing.message ? <p className={styles.unitPrice} role="status">{product.pricing.message}</p> : null}
                        </div>
                        <button
                          className={styles.removeButton}
                          type="button"
                          aria-label={`Eliminar ${item.name} del carrito`}
                          onClick={() => removeItem(item.productId)}
                        >
                          <svg viewBox="0 0 20 20" aria-hidden="true">
                            <path d="M3 5h14M8 5V3h4v2m3 0-.8 11H5.8L5 5m3 3v5m4-5v5" />
                          </svg>
                          <span>Eliminar</span>
                        </button>
                      </div>

                      <div className={styles.itemFooter}>
                        <div
                          className={styles.quantityControl}
                          role="group"
                          aria-label={`Cantidad de ${item.name}`}
                        >
                          <button
                            type="button"
                            aria-label={`Disminuir cantidad de ${item.name}`}
                            disabled={item.quantity <= minimum || !contextReady}
                            onClick={() => decrementItem(item.productId)}
                          >
                            <span aria-hidden="true">−</span>
                          </button>
                          <span className={styles.quantity} aria-live="polite">{item.quantity}</span>
                          <button
                            type="button"
                            aria-label={`Aumentar cantidad de ${item.name}`}
                            disabled={!contextReady || !product || product.inventory.quantity === null || item.quantity >= product.inventory.quantity}
                            onClick={() => incrementItem(item.productId)}
                          >
                            <span aria-hidden="true">+</span>
                          </button>
                        </div>
                        <p className={styles.itemSubtotal}>
                          <span>Subtotal</span>
                          <strong>{itemSubtotal === null ? 'No disponible' : priceFormatter.format(itemSubtotal)}</strong>
                        </p>
                      </div>
                    </div>
                  </article>
                )
              })}
            </div>

            <aside className={styles.summary} aria-labelledby="summary-title">
              <h3 id="summary-title">Resumen del carrito</h3>
              <p className={styles.summaryUnits}>{user?.role === 'B2B' ? 'Precios B2B · condiciones comerciales vigentes' : 'Precios Retail'}</p>
              <p className={styles.summaryUnits}>
                {totalUnits} {totalUnits === 1 ? 'producto' : 'productos'}
              </p>
              <div className={styles.summaryRow}>
                <span>Subtotal</span>
                <strong>{unresolved || !contextReady ? '—' : priceFormatter.format(subtotal)}</strong>
              </div>
              <div className={styles.summaryRow}>
                <span>IVA (13%)</span>
                <strong>{unresolved || !contextReady ? '—' : priceFormatter.format(tax)}</strong>
              </div>
              <div className={styles.summaryRow}>
                <span>Envío</span>
                <strong>{unresolved || !contextReady ? '—' : priceFormatter.format(shipping)}</strong>
              </div>
              <div className={styles.summaryTotal}>
                <span>Total</span>
                <strong>{unresolved || !contextReady ? '—' : priceFormatter.format(total)}</strong>
              </div>
              {purchaseBlockReason || !user ? <div className={styles.identityPrompt}>
                <p className={styles.identityPromptTitle}>
                  <svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="6" r="3" /><path d="M4 17v-2a6 6 0 0 1 12 0v2" /></svg>
                  Antes de finalizar
                </p>
                {purchaseBlockReason ? <p className={styles.identityPromptMessage} role="status" id="cart-checkout-restriction">{purchaseBlockReason}</p> : null}
                {!user ? <button className={styles.identityButton} type="button" onClick={openLogin}>
                  Seleccionar identidad
                  <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 10h12m-5-5 5 5-5 5" /></svg>
                </button> : null}
              </div> : null}
              {checkoutBlock ? <p className={styles.identityPromptMessage} role="status" id="cart-checkout-restriction">{checkoutBlock}</p> : null}
              <button className={styles.checkoutButton} type="button" disabled={Boolean(checkoutBlock)}
                aria-describedby={checkoutBlock ? 'cart-checkout-restriction' : undefined} onClick={onCheckoutRequested}>
                Finalizar compra
              </button>
              <a href="#catalog" onClick={handleContinueShopping}>
                Seguir comprando
              </a>
            </aside>
          </div>
        )}
      </div>
    </section>
  )
}

export default CartSection
