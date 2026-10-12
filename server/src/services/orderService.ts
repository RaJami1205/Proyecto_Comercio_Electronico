import { randomUUID } from 'node:crypto'
import { calculateLineSubtotal, calculateOrderTotals } from '../domain/orderCalculations.js'
import { OrderError } from '../domain/orderError.js'
import { validateCreateOrderRequest } from '../domain/orderValidation.js'
import { orderStore, type OrderStore } from '../stores/orderStore.js'
import type { CreateOrderRequest, Order, OrderItem } from '../types/order.js'
import type { ProductRecord } from '../types/product.js'
import { getProductById } from './productService.js'

type ProductLookup = (id: string) => Promise<ProductRecord | undefined>

export class OrderService {
  private readonly pending = new Map<string, Promise<Order>>()
  constructor(private readonly store: OrderStore = orderStore, private readonly lookup: ProductLookup = getProductById) {}

  async create(value: unknown): Promise<Order> {
    const request = validateCreateOrderRequest(value)
    const existing = this.store.findByIdempotencyKey(request.idempotencyKey)
    if (existing) return existing
    const pending = this.pending.get(request.idempotencyKey)
    if (pending) return structuredClone(await pending)
    const task = this.buildOrder(request)
    this.pending.set(request.idempotencyKey, task)
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
    for (const { productId } of request.items) {
      if (products.has(productId)) continue
      const product = await this.lookup(productId)
      if (!product) throw new OrderError(404, 'PRODUCT_NOT_FOUND', 'Un producto solicitado no existe.')
      if (product.objectID !== productId || typeof product.price !== 'number' || !Number.isFinite(product.price) || product.price < 0 || !product.title?.trim()) {
        throw new OrderError(503, 'UNEXPECTED_ERROR', 'Un producto no está disponible para crear la orden.')
      }
      products.set(productId, product)
    }
    const items: OrderItem[] = request.items.map(({ productId, quantity }) => {
      const product = products.get(productId)!
      const unitPrice = Math.round(product.price! * 100) / 100
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
