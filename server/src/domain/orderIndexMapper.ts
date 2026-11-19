/** Transforma una Order persistida en su registro indexable sin consultar el catálogo ni recalcular importes. */
import type { OrderIndexRecord, OrderIndexSource } from '../types/orderIndex.js'
import { OrderIndexError } from './orderIndexError.js'

const USER_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/
const BRANCH_IDS = ['san_jose', 'alajuela', 'cartago', 'heredia']
// Algolia admite objectID de hasta 512 bytes.
const MAX_OBJECT_ID_BYTES = 512

function invalid(): never { throw new OrderIndexError('invalid-record') }

function text(value: unknown): string {
  return typeof value === 'string' && value.trim() ? value : invalid()
}

/** Copia cada campo explícitamente: Buyer, Delivery, items y Terms nunca llegan al registro. */
export function toOrderIndexRecord(source: OrderIndexSource): OrderIndexRecord {
  const { order } = source
  const objectID = text(order.id)
  if (Buffer.byteLength(objectID, 'utf8') > MAX_OBJECT_ID_BYTES) invalid()
  if (!USER_ID_PATTERN.test(source.ownerUserId)) invalid()
  const role = source.customerRole
  if (role !== 'B2C' && role !== 'B2B') invalid()

  const contractVersion = order.contractVersion ?? 1
  const commercial = order.commercial
  if (contractVersion === 2) {
    if (!commercial || commercial.userId !== source.ownerUserId || commercial.customerRole !== role
      || !BRANCH_IDS.includes(commercial.branchId)) invalid()
  } else if (commercial !== undefined || role !== 'B2C') invalid()

  const company = source.company
  if (role === 'B2B' && !company) invalid()
  if (role === 'B2C' && company !== undefined) invalid()

  const createdAtMs = Date.parse(order.createdAt)
  if (!Number.isFinite(createdAtMs)) invalid()
  const total = order.totals.total
  if (typeof total !== 'number' || !Number.isFinite(total) || total < 0) invalid()
  if (!Number.isSafeInteger(source.indexVersion) || source.indexVersion < 1) invalid()
  if (order.currency !== 'CRC') invalid()
  if (!((order.orderStatus === 'CONFIRMED' && order.paymentStatus === 'APPROVED')
    || (order.orderStatus === 'PENDING' && ['PENDING', 'DECLINED', 'ERROR'].includes(order.paymentStatus)))) invalid()

  return {
    objectID,
    orderNumber: text(order.orderNumber),
    userId: source.ownerUserId,
    customerRole: role,
    branchId: commercial?.branchId ?? null,
    createdAt: new Date(createdAtMs).toISOString(),
    createdAtTimestamp: Math.floor(createdAtMs / 1000),
    orderStatus: order.orderStatus,
    paymentStatus: order.paymentStatus,
    total,
    currency: 'CRC',
    indexVersion: source.indexVersion,
    contractVersion,
    ...(role === 'B2B' && company ? { company: { id: text(company.id), name: text(company.name) } } : {}),
  }
}
