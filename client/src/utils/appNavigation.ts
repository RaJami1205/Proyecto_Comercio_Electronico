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
  ...policyDestinations,
] as const
export type AppView = 'catalog' | typeof destinations[number]['view']

/** Resuelve destinos explícitos; las anclas del catálogo y hashes desconocidos conservan el fallback actual. */
export function viewFromHash(hash: string): AppView {
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
