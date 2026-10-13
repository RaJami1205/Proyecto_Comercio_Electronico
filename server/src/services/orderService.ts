import { randomUUID } from 'node:crypto'
import { calculateLineSubtotal, calculateOrderTotals } from '../domain/orderCalculations.js'
import { OrderError } from '../domain/orderError.js'
import { validateCreateOrderRequest } from '../domain/orderValidation.js'
import { orderStore, type OrderStore } from '../stores/orderStore.js'
import type { CreateOrderRequest, Order, OrderItem } from '../types/order.js'
import type { ProductRecord } from '../types/product.js'
import { getProductById } from './productService.js'

type ProductLookup = (id: string) => Promise<ProductRecord | undefined>

function quantities(items: CreateOrderRequest['items']): Map<string, number> {
  const result = new Map<string, number>()
  for (const { productId, quantity } of items) {
    const total = (result.get(productId) ?? 0) + quantity
    if (!Number.isSafeInteger(total)) throw new OrderError(400, 'CHECKOUT_VALIDATION_ERROR', 'La cantidad total de un producto excede el límite permitido.')
    result.set(productId, total)
  }
  return result
}

/** La identidad excluye precios/estados y normaliza orden de líneas y notas vacías. */
function identity({ buyer, delivery, items }: Pick<CreateOrderRequest, 'buyer' | 'delivery' | 'items'>): string {
  return JSON.stringify([
    buyer.fullName, buyer.email, buyer.phone,
    delivery.province, delivery.canton, delivery.address, delivery.additionalInfo ?? '',
    [...quantities(items)].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0),
  ])
}

function requireCompatible(expected: string, received: string): void {
  if (expected !== received) throw new OrderError(409, 'CHECKOUT_VALIDATION_ERROR', 'La clave de idempotencia ya está asociada a una solicitud diferente.', { idempotencyKey: 'Utiliza la misma clave únicamente para repetir la misma compra.' })
}

export class OrderService {
  private readonly pending = new Map<string, { identity: string; task: Promise<Order> }>()
  constructor(private readonly store: OrderStore = orderStore, private readonly lookup: ProductLookup = getProductById) {}

  async create(value: unknown): Promise<Order> {
    const request = validateCreateOrderRequest(value)
    const fingerprint = identity(request)
    const existing = this.store.findByIdempotencyKey(request.idempotencyKey)
    if (existing) {
      // El snapshot conserva Buyer/Delivery/items originales, incluso después del pago.
      requireCompatible(identity(existing), fingerprint)
      return existing
    }
    const pending = this.pending.get(request.idempotencyKey)
    if (pending) {
      requireCompatible(pending.identity, fingerprint)
      return structuredClone(await pending.task)
    }
    // Registra la identidad antes de iniciar incluso la primera consulta asíncrona.
    const task = Promise.resolve().then(() => this.buildOrder(request))
    this.pending.set(request.idempotencyKey, { identity: fingerprint, task })
    try { return structuredClone(await task) }
    finally { this.pending.delete(request.idempotencyKey) }
  }

  findById(id: string): Order {
    const order = this.store.findById(id)
    if (!order) throw new OrderError(404, 'ORDER_NOT_FOUND', 'La orden solicitada no existe.')
    return order
  }

  private async buildOrder(request: CreateOrderRequest): Promise<Order> {
    const products = new Map<string, ProductRecord>()
    for (const [productId, quantity] of quantities(request.items)) {
      const product = await this.lookup(productId)
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
    const id = randomUUID()
    const createdAt = new Date().toISOString()
    const order: Order = {
      id, orderNumber: 'CN-' + createdAt.slice(0, 4) + '-' + id.toUpperCase(), createdAt,
      buyer: request.buyer, delivery: request.delivery, items, totals: calculateOrderTotals(items),
      currency: 'CRC', orderStatus: 'PENDING', paymentStatus: 'PENDING',
    }
    return this.store.create(order, request.idempotencyKey)
  }
}

export const orderService = new OrderService()
