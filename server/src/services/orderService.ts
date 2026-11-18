/** Crea snapshots comerciales; delega la atomicidad Create-or-Replay al store async seleccionado. */
import { calculateLineSubtotal, calculateOrderTotals } from '../domain/orderCalculations.js'
import { OrderError } from '../domain/orderError.js'
import { validateCreateOrderRequest, validateCreateOrderV2Request } from '../domain/orderValidation.js'
import { isCurrentTermsVersion } from '../domain/termsPolicy.js'
import { orderIdentity, orderIdentityV2, orderQuantities, requireCompatible, requireOrderOwner } from '../domain/orderIdentity.js'
import { orderReadScope } from '../domain/orderAccess.js'
import type { OrderStore } from '../stores/orderStore.js'
import { commerceStores } from '../stores/commerceStores.js'
import type { CreateOrderRequest, Order, OrderItem } from '../types/order.js'
import type { ResolvedUser } from '../types/user.js'
import type { ProductRecord } from '../types/product.js'
import { getProductById } from './productService.js'
import { resolvePricing, validateCommercialQuantity } from '../domain/pricing.js'
import { validateBranchQuantity } from '../domain/inventory.js'
import { CatalogError } from '../domain/catalogError.js'

type ProductLookup = (id: string) => Promise<ProductRecord | undefined>

export class OrderService {
  private readonly pending = new Map<string, { ownerId: string; identity: string; task: Promise<Order> }>()
  constructor(private readonly store: OrderStore = commerceStores.orders, private readonly lookup: ProductLookup = getProductById) {}

  /** La identidad procede de CN-54, no del body. Promise Sharing no sustituye la unicidad del store. */
  async create(value: unknown, user: ResolvedUser, { replayOnly = false }: { replayOnly?: boolean } = {}): Promise<Order> {
    if (user.role !== 'B2C') throw new OrderError(403, 'FORBIDDEN', 'Esta identidad no tiene permiso para realizar la operación.')
    const request = validateCreateOrderRequest(value)
    const fingerprint = orderIdentity(request)
    // Captura la política al recibir la solicitud, igual que V1; se exige solo si el store gana una creación nueva.
    const currentTermsAccepted = isCurrentTermsVersion(request.termsAcceptance.version)
    const ownerId = user.id
    const pending = this.pending.get(request.idempotencyKey)
    if (pending) {
      requireOrderOwner(pending.ownerId, ownerId)
      requireCompatible(pending.identity, fingerprint)
      return structuredClone(await pending.task)
    }
    const context = { idempotencyKey: request.idempotencyKey, canonicalPayload: fingerprint, canonicalVersion: 1 as const,
      user: { id: user.id, displayName: user.displayName, role: 'B2C' as const } }
    const task = Promise.resolve().then(() => this.store.createOrReplay(context, (id, signal) => {
      // El store comprueba ownership/payload antes del builder. Una key nueva falla sin catálogo ni Order;
      // PostgreSQL revierte también el claim, conservando su atomicidad y Recovery existentes.
      if (replayOnly) throw new OrderError(410, 'ORDER_CONTRACT_DEPRECATED', 'La creación legacy está deshabilitada. Utiliza Orders V2 con sucursal seleccionada.')
      return this.buildOrder(request, id, currentTermsAccepted, signal)
    }))
    this.pending.set(request.idempotencyKey, { ownerId, identity: fingerprint, task })
    try { return structuredClone(await task) }
    finally { this.pending.delete(request.idempotencyKey) }
  }

  /** Crea/reproduce una Order V2 con precio, MOQ, sucursal e inventario autoritativos. */
  async createV2(value: unknown, user: ResolvedUser): Promise<Order> {
    if (user.role === 'ADMIN') throw new OrderError(403, 'FORBIDDEN', 'La identidad administrativa no puede realizar compras.')
    const request = validateCreateOrderV2Request(value)
    const fingerprint = orderIdentityV2(request, user)
    const externalKey = request.idempotencyKey
    const storageKey = `${user.id}:${externalKey}`
    const currentTermsAccepted = isCurrentTermsVersion(request.termsAcceptance.version)
    const pending = this.pending.get(storageKey)
    if (pending) {
      requireOrderOwner(pending.ownerId, user.id)
      requireCompatible(pending.identity, fingerprint)
      return structuredClone(await pending.task)
    }
    const context = { idempotencyKey: storageKey, canonicalPayload: fingerprint, canonicalVersion: 2 as const, user: structuredClone(user) }
    const task = Promise.resolve().then(() => this.store.createOrReplay(context,
      (id, signal) => this.buildOrderV2(request, user, id, currentTermsAccepted, signal)))
    this.pending.set(storageKey, { ownerId: user.id, identity: fingerprint, task })
    try { return structuredClone(await task) }
    finally { this.pending.delete(storageKey) }
  }

  /** Compatibilidad interna previa al CN-63: lectura acotada a un propietario ya conocido. */
  async findById(id: string, ownerId: string): Promise<Order> {
    const order = await this.store.findByIdForOwner(id, ownerId)
    if (!order) throw new OrderError(404, 'ORDER_NOT_FOUND', 'La orden solicitada no existe.')
    return order
  }

  /**
   * Consulta individual autorizada. La propiedad se verifica contra el owner almacenado en la persistencia
   * (PostgreSQL cuando está configurado), nunca contra datos del body ni contra Algolia.
   * Inexistente, ajena o sin propietario verificable responden igual (404) para no revelar Orders de otros usuarios.
   */
  async findAuthorized(id: string, user: ResolvedUser): Promise<Order> {
    const scope = orderReadScope(user)
    const order = scope.kind === 'all'
      ? await this.store.findById(id)
      : await this.store.findByIdForOwner(id, scope.ownerId)
    if (!order) throw new OrderError(404, 'ORDER_NOT_FOUND', 'La orden solicitada no existe.')
    return order
  }

  /** Sin IO de persistencia: un resultado tardío del catálogo nunca puede insertar una Order. */
  private async buildOrder(request: CreateOrderRequest, id: string, currentTermsAccepted: boolean, signal?: AbortSignal): Promise<Order> {
    signal?.throwIfAborted()
    if (!currentTermsAccepted) {
      throw new OrderError(400, 'CHECKOUT_VALIDATION_ERROR', 'Debes aceptar la versión vigente de los términos.', {
        'termsAcceptance.version': 'Esta versión ya no está vigente para una nueva orden.',
      })
    }
    const products = new Map<string, ProductRecord>()
    for (const [productId, quantity] of orderQuantities(request.items)) {
      signal?.throwIfAborted()
      const product = await this.lookup(productId)
      signal?.throwIfAborted()
      if (!product) throw new OrderError(404, 'PRODUCT_NOT_FOUND', 'Un producto solicitado no existe.')
      if (product.objectID !== productId || typeof product.price !== 'number' || !Number.isFinite(product.price) || product.price < 0 || !product.title?.trim()) {
        throw new OrderError(503, 'UNEXPECTED_ERROR', 'Un producto no está disponible para crear la orden.')
      }
      if (product.in_stock !== true || typeof product.stock_quantity !== 'number' || !Number.isSafeInteger(product.stock_quantity) || product.stock_quantity <= 0 || quantity > product.stock_quantity) {
        throw new OrderError(400, 'CHECKOUT_VALIDATION_ERROR', 'Un producto no tiene disponibilidad suficiente para la cantidad solicitada.', { items: 'Revisa la disponibilidad y las cantidades de los productos.' })
      }
      products.set(productId, product)
    }
    const items: OrderItem[] = request.items.map(({ productId, quantity }) => {
      const product = products.get(productId)!
      const unitPrice = product.price!
      return { productId, name: product.title, image: product.image_url ?? '', unitPrice, quantity, lineSubtotal: calculateLineSubtotal(unitPrice, quantity) }
    })
    const createdAt = new Date().toISOString()
    return {
      id, orderNumber: 'CN-' + createdAt.slice(0, 4) + '-' + id.toUpperCase(), createdAt,
      buyer: request.buyer, delivery: request.delivery, items, totals: calculateOrderTotals(items),
      currency: 'CRC', orderStatus: 'PENDING', paymentStatus: 'PENDING',
      termsAcceptance: { accepted: true, version: request.termsAcceptance.version, acceptedAt: createdAt },
    }
  }

  /** Calcula snapshots agrupados por producto, de forma que líneas repetidas no evadan MOQ ni stock. */
  private async buildOrderV2(request: CreateOrderRequest & { branchId: NonNullable<CreateOrderRequest['branchId']> }, user: ResolvedUser,
    id: string, currentTermsAccepted: boolean, signal?: AbortSignal): Promise<Order> {
    signal?.throwIfAborted()
    if (!currentTermsAccepted) throw new OrderError(400, 'CHECKOUT_VALIDATION_ERROR', 'Debes aceptar la versión vigente de los términos.', {
      'termsAcceptance.version': 'Esta versión ya no está vigente para una nueva orden.',
    })

    const products = new Map<string, { record: ProductRecord; quantity: number; price: number; minOrderQuantity: number }>()
    for (const [productId, quantity] of orderQuantities(request.items)) {
      signal?.throwIfAborted()
      const record = await this.lookup(productId)
      signal?.throwIfAborted()
      if (!record || record.objectID !== productId) throw new OrderError(404, 'PRODUCT_NOT_FOUND', 'Un producto solicitado no existe.')
      if (typeof record.title !== 'string' || !record.title.trim()) throw new OrderError(422, 'INVALID_PRODUCT_PRICE', 'Un producto no tiene información comercial válida.')

      const pricing = resolvePricing(record, user.role)
      if (pricing.issue === 'B2B_NOT_AVAILABLE') throw new OrderError(422, 'B2B_NOT_AVAILABLE', 'Un producto no está habilitado para compras B2B.', { items: productId })
      if (pricing.issue === 'INVALID_MOQ') throw new OrderError(422, 'INVALID_MOQ', 'El mínimo de compra de un producto no es válido.', { items: productId })
      if (pricing.issue === 'INVALID_B2B_DATA') throw new OrderError(422, 'INVALID_B2B_DATA', 'Las condiciones comerciales del producto no son válidas.', { items: productId })
      if (pricing.price === null || pricing.minOrderQuantity === null || !pricing.eligible) {
        throw new OrderError(422, 'INVALID_PRODUCT_PRICE', 'Un producto no tiene un precio válido para este comprador.', { items: productId })
      }
      const commercialQuantity = validateCommercialQuantity(pricing, quantity)
      if (!commercialQuantity.valid) throw new OrderError(422, commercialQuantity.code ?? 'INVALID_MOQ', commercialQuantity.message ?? 'La cantidad no cumple las condiciones comerciales.', { items: productId })

      try {
        validateBranchQuantity(record, request.branchId, quantity, pricing.minOrderQuantity)
      } catch (error) {
        if (error instanceof CatalogError) throw new OrderError(error.status, error.code, error.message,
          { [error.code === 'INVALID_BRANCH_ID' ? 'branchId' : 'items']: productId })
        throw error
      }
      products.set(productId, { record, quantity, price: pricing.price, minOrderQuantity: pricing.minOrderQuantity })
    }

    const items: OrderItem[] = [...products].map(([productId, product]) => ({
      productId, name: product.record.title, image: product.record.image_url ?? '', unitPrice: product.price,
      quantity: product.quantity, lineSubtotal: calculateLineSubtotal(product.price, product.quantity),
      minOrderQuantity: product.minOrderQuantity,
    }))
    const totals = calculateOrderTotals(items)
    for (const key of ['subtotal', 'tax', 'shipping', 'total'] as const) {
      const expected = request.financialExpectation?.[key]
      if (expected !== undefined && expected !== totals[key]) {
        throw new OrderError(409, 'CHECKOUT_VALIDATION_ERROR', 'Los importes cambiaron. Revisa el resumen antes de continuar.', { ['financialExpectation.' + key]: 'El importe estimado no coincide con el cálculo actual del servidor.' })
      }
    }
    const createdAt = new Date().toISOString()
    const customerRole = user.role as 'B2C' | 'B2B'
    const pricingType: 'WHOLESALE' | 'RETAIL' = customerRole === 'B2B' ? 'WHOLESALE' : 'RETAIL'
    const commercial = { userId: user.id, customerRole, ...(customerRole === 'B2B' ? { company: structuredClone(user.company) } : {}),
      branchId: request.branchId, pricingType, policyVersion: 'CIBERNOVA-COMMERCIAL-V1' as const }
    return {
      id, orderNumber: 'CN-' + createdAt.slice(0, 4) + '-' + id.toUpperCase(), createdAt,
      buyer: request.buyer, delivery: request.delivery, items, totals,
      currency: 'CRC', orderStatus: 'PENDING', paymentStatus: 'PENDING',
      termsAcceptance: { accepted: true, version: request.termsAcceptance.version, acceptedAt: createdAt },
      contractVersion: 2, commercial,
    }
  }
}

export const orderService = new OrderService()
