/** Define los destinos hash de App y las interacciones que puede manejar sin sustituir al navegador. */
import type { MouseEvent } from 'react'

export const policyDestinations = [
  { view: 'terms', hash: '#terms', title: 'Términos y condiciones' },
  { view: 'returns-policy', hash: '#returns-policy', title: 'Política de devoluciones' },
  { view: 'shipping-policy', hash: '#shipping-policy', title: 'Política de envíos' },
  { view: 'privacy-policy', hash: '#privacy-policy', title: 'Política de privacidad' },
  { view: 'faq', hash: '#faq', title: 'Preguntas frecuentes' },
] as const

export type PolicyDestination = typeof policyDestinations[number]
export type PolicyView = PolicyDestination['view']
export type CatalogHash = '' | '#top' | '#catalog' | '#about'

const destinations = [
  { view: 'cart', hash: '#cart-page' },
  { view: 'checkout', hash: '#checkout' },
  { view: 'analytics', hash: '#analytics' },
  { view: 'orders', hash: '#my-orders' },
  { view: 'admin-products', hash: '#admin/products' },
  ...policyDestinations,
] as const
export type AppView = 'catalog' | 'order-detail' | 'admin-product-detail' | typeof destinations[number]['view']

const ORDER_DETAIL_PREFIX = '#my-orders/'
const ADMIN_PRODUCT_PREFIX = '#admin/products/'

/** Vistas administrativas (CN-67); App las revoca si la Session activa no es ADMIN. */
export const isAdminView = (view: AppView) => view === 'admin-products' || view === 'admin-product-detail'

/** Extrae el Product ID de #admin/products/<id> con las mismas reglas que el detalle de Orders. */
export function adminProductIdFromHash(hash: string): string | null {
  if (!hash.startsWith(ADMIN_PRODUCT_PREFIX)) return null
  const encoded = hash.slice(ADMIN_PRODUCT_PREFIX.length)
  if (encoded.includes('/')) return null
  try {
    const id = decodeURIComponent(encoded)
    return id.trim() ? id : null
  } catch { return null }
}

/** Hash directo al detalle administrativo, compatible con recarga y Back/Forward. */
export function hashForAdminProduct(productId: string): string {
  return ADMIN_PRODUCT_PREFIX + encodeURIComponent(productId)
}

/** Extrae el Order ID de #my-orders/<id>; un ID vacío o mal codificado no abre ningún detalle. */
export function orderIdFromHash(hash: string): string | null {
  if (!hash.startsWith(ORDER_DETAIL_PREFIX)) return null
  const encoded = hash.slice(ORDER_DETAIL_PREFIX.length)
  // hashForOrder codifica cualquier "/" del ID; una barra sin codificar no corresponde a un detalle.
  if (encoded.includes('/')) return null
  try {
    const id = decodeURIComponent(encoded)
    return id.trim() ? id : null
  } catch { return null }
}

/** Hash de acceso directo al detalle; codifica el ID para conservarlo en recargas y Back/Forward. */
export function hashForOrder(orderId: string): string {
  return ORDER_DETAIL_PREFIX + encodeURIComponent(orderId)
}

/** Resuelve destinos explícitos; las anclas del catálogo y hashes desconocidos conservan el fallback actual. */
export function viewFromHash(hash: string): AppView {
  if (orderIdFromHash(hash)) return 'order-detail'
  if (adminProductIdFromHash(hash)) return 'admin-product-detail'
  return destinations.find(destination => destination.hash === hash)?.view ?? 'catalog'
}

/** Devuelve el hash de una vista; el catálogo usa sus propias anclas. */
export function hashForView(view: AppView): string {
  return destinations.find(destination => destination.view === view)?.hash ?? ''
}

/** Deja clicks modificados, otras pestañas y eventos ya gestionados en manos del navegador. */
export function isSameTabNavigation(event: MouseEvent<HTMLAnchorElement>): boolean {
  return !event.defaultPrevented && event.button === 0
    && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey
    && (!event.currentTarget.target || event.currentTarget.target === '_self')
}
