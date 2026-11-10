/** Crea snapshots comerciales; delega la atomicidad Create-or-Replay al store async seleccionado. */
import { calculateLineSubtotal, calculateOrderTotals } from '../domain/orderCalculations.js'
import { OrderError } from '../domain/orderError.js'
import { validateCreateOrderRequest } from '../domain/orderValidation.js'
import { isCurrentTermsVersion } from '../domain/termsPolicy.js'
import { orderIdentity, orderQuantities, requireCompatible, requireOrderOwner } from '../domain/orderIdentity.js'
import { orderStore, type OrderStore } from '../stores/orderStore.js'
import type { CreateOrderRequest, Order, OrderItem } from '../types/order.js'
import type { ResolvedUser } from '../types/user.js'
import type { ProductRecord } from '../types/product.js'
import { getProductById } from './productService.js'

type ProductLookup = (id: string) => Promise<ProductRecord | undefined>

export class OrderService {
  private readonly pending = new Map<string, { ownerId: string; identity: string; task: Promise<Order> }>()
  constructor(private readonly store: OrderStore = orderStore, private readonly lookup: ProductLookup = getProductById) {}

  /** La identidad procede de CN-54, no del body. Promise Sharing no sustituye la unicidad del store. */
  async create(value: unknown, user: ResolvedUser): Promise<Order> {
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
    const task = Promise.resolve().then(() => this.store.createOrReplay(context, (id, signal) => this.buildOrder(request, id, currentTermsAccepted, signal)))
    this.pending.set(request.idempotencyKey, { ownerId, identity: fingerprint, task })
    try { return structuredClone(await task) }
    finally { this.pending.delete(request.idempotencyKey) }
  }

  async findById(id: string, ownerId: string): Promise<Order> {
    const order = await this.store.findByIdForOwner(id, ownerId)
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
}

export const orderService = new OrderService()
