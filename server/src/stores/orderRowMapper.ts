/** Frontera PostgreSQL/DTO V1. No recalcula importes ni consulta contratos comerciales actuales. */
import { DatabaseError } from '../db/databaseError.js'
import type { Order, OrderItem } from '../types/order.js'
import type { B2CUser } from '../types/user.js'

function invalid(): never { throw new DatabaseError('transaction') }
export function rowRecord(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return invalid()
  return value as Record<string, unknown>
}
function text(value: unknown): string { return typeof value === 'string' && value.trim() ? value : invalid() }
function money(value: unknown): number {
  if (typeof value !== 'number' && (typeof value !== 'string' || !/^[0-9]+(?:\.[0-9]+)?(?:e[+-]?[0-9]+)?$/i.test(value))) return invalid()
  const amount = Number(value)
  return Number.isFinite(amount) && amount >= 0 && amount <= Number.MAX_SAFE_INTEGER / 100 ? amount : invalid()
}
function timestamp(value: unknown): string {
  if (typeof value === 'string') {
    const parts = /^(\d{4})-(\d{2})-(\d{2})T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.exec(value)
    if (!parts) return invalid()
    // Date normaliza días inexistentes; validar el calendario antes de convertir a UTC.
    const year = Number(parts[1]), month = Number(parts[2]), day = Number(parts[3])
    const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
    const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1]
    if (daysInMonth === undefined || day < 1 || day > daysInMonth) return invalid()
  } else if (!(value instanceof Date)) return invalid()
  const date = value instanceof Date ? value : new Date(value)
  return Number.isFinite(date.getTime()) ? date.toISOString() : invalid()
}

/** Valida la identidad histórica, sin exponerla como parte del DTO público de Order. */
function validateUser(value: unknown, owner: string): void {
  const user = rowRecord(value)
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(owner) || user.id !== owner
    || Object.keys(user).some(key => !['id', 'displayName', 'role', 'company'].includes(key))) return invalid()
  text(user.displayName)
  if (user.role === 'B2C' && !('company' in user)) return
  if (user.role === 'B2B') {
    const company = rowRecord(user.company)
    if (Object.keys(company).some(key => !['id', 'name'].includes(key))) return invalid()
    text(company.id); text(company.name)
    return
  }
  return invalid()
}

function item(value: unknown): OrderItem {
  const row = rowRecord(value)
  if (typeof row.image !== 'string' || typeof row.quantity !== 'number' || !Number.isSafeInteger(row.quantity) || row.quantity <= 0
    || typeof row.unitPrice !== 'number' || typeof row.lineSubtotal !== 'number') return invalid()
  return { productId: text(row.productId), name: text(row.name), image: row.image, quantity: row.quantity,
    unitPrice: money(row.unitPrice), lineSubtotal: money(row.lineSubtotal) }
}

export function mapOrderRow(value: unknown): Order {
  const row = rowRecord(value)
  validateUser(row.user_snapshot, text(row.owner_user_id))
  if (row.contract_version !== 1 || row.currency !== 'CRC' || row.terms_accepted !== true
    || (row.branch_id !== null && (typeof row.branch_id !== 'string' || !['san_jose', 'alajuela', 'cartago', 'heredia'].includes(row.branch_id)))) return invalid()
  if (!((row.order_status === 'CONFIRMED' && row.payment_status === 'APPROVED')
    || (row.order_status === 'PENDING' && typeof row.payment_status === 'string' && ['PENDING', 'DECLINED', 'ERROR'].includes(row.payment_status)))) return invalid()
  if (!Array.isArray(row.items_snapshot) || !row.items_snapshot.length) return invalid()
  const buyer = rowRecord(row.buyer_snapshot), delivery = rowRecord(row.delivery_snapshot)
  if (delivery.additionalInfo !== undefined && typeof delivery.additionalInfo !== 'string') return invalid()
  timestamp(row.updated_at)
  return {
    id: text(row.id), orderNumber: text(row.order_number), createdAt: timestamp(row.created_at),
    buyer: { fullName: text(buyer.fullName), email: text(buyer.email), phone: text(buyer.phone) },
    delivery: { province: text(delivery.province), canton: text(delivery.canton), address: text(delivery.address),
      ...(delivery.additionalInfo !== undefined ? { additionalInfo: delivery.additionalInfo } : {}) },
    items: row.items_snapshot.map(item), totals: { subtotal: money(row.subtotal), tax: money(row.tax), shipping: money(row.shipping), total: money(row.total) },
    currency: 'CRC', orderStatus: row.order_status as Order['orderStatus'], paymentStatus: row.payment_status as Order['paymentStatus'],
    termsAcceptance: { accepted: true, version: text(row.terms_version), acceptedAt: timestamp(row.terms_accepted_at) },
  }
}

export const ORDER_COLUMNS = ['id', 'order_number', 'owner_user_id', 'user_snapshot', 'contract_version', 'branch_id',
  'buyer_snapshot', 'delivery_snapshot', 'items_snapshot', 'currency', 'subtotal', 'tax', 'shipping', 'total',
  'terms_accepted', 'terms_version', 'terms_accepted_at', 'order_status', 'payment_status', 'created_at', 'updated_at'] as const

/** Valida el DTO JSONB histórico de Payment sin completar campos desde la Order actual. */
export function mapOrderSnapshot(value: unknown): Order {
  const snapshot = rowRecord(value), totals = rowRecord(snapshot.totals), terms = rowRecord(snapshot.termsAcceptance)
  const buyer = rowRecord(snapshot.buyer), delivery = rowRecord(snapshot.delivery)
  if (snapshot.currency !== 'CRC' || terms.accepted !== true || typeof snapshot.createdAt !== 'string' || typeof terms.acceptedAt !== 'string'
    || !Array.isArray(snapshot.items) || !snapshot.items.length
    || (delivery.additionalInfo !== undefined && typeof delivery.additionalInfo !== 'string')) return invalid()
  if (!((snapshot.orderStatus === 'CONFIRMED' && snapshot.paymentStatus === 'APPROVED')
    || (snapshot.orderStatus === 'PENDING' && typeof snapshot.paymentStatus === 'string' && ['PENDING', 'DECLINED', 'ERROR'].includes(snapshot.paymentStatus)))) return invalid()
  for (const key of ['subtotal', 'tax', 'shipping', 'total']) if (typeof totals[key] !== 'number') return invalid()
  return {
    id: text(snapshot.id), orderNumber: text(snapshot.orderNumber), createdAt: timestamp(snapshot.createdAt),
    buyer: { fullName: text(buyer.fullName), email: text(buyer.email), phone: text(buyer.phone) },
    delivery: { province: text(delivery.province), canton: text(delivery.canton), address: text(delivery.address),
      ...(delivery.additionalInfo !== undefined ? { additionalInfo: delivery.additionalInfo } : {}) },
    items: snapshot.items.map(item),
    totals: { subtotal: money(totals.subtotal), tax: money(totals.tax), shipping: money(totals.shipping), total: money(totals.total) },
    currency: 'CRC', orderStatus: snapshot.orderStatus as Order['orderStatus'], paymentStatus: snapshot.paymentStatus as Order['paymentStatus'],
    termsAcceptance: { accepted: true, version: text(terms.version), acceptedAt: timestamp(terms.acceptedAt) },
  }
}

export { timestamp as orderTimestamp }

/** Conserva NUMERIC como strings y JSONB como snapshots, con validación del round-trip antes de escribir. */
export function orderToRow(order: Order, user: B2CUser): Record<(typeof ORDER_COLUMNS)[number], unknown> {
  const row = {
    id: order.id, order_number: order.orderNumber, owner_user_id: user.id,
    user_snapshot: { id: user.id, displayName: user.displayName, role: user.role }, contract_version: 1, branch_id: null,
    buyer_snapshot: order.buyer, delivery_snapshot: order.delivery, items_snapshot: order.items, currency: order.currency,
    subtotal: String(order.totals.subtotal), tax: String(order.totals.tax), shipping: String(order.totals.shipping), total: String(order.totals.total),
    terms_accepted: order.termsAcceptance.accepted, terms_version: order.termsAcceptance.version,
    terms_accepted_at: order.termsAcceptance.acceptedAt, order_status: order.orderStatus, payment_status: order.paymentStatus,
    created_at: order.createdAt, updated_at: order.createdAt,
  }
  mapOrderRow(row)
  return row
}
