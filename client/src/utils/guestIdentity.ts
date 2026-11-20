/**
 * Compra como invitado: ID aleatorio que vive solo en memoria de React (nunca en localStorage, sessionStorage ni cookies).
 * El Server lo resuelve como comprador B2C a precio Retail; recargar la página pierde el acceso a esas Orders.
 */
import type { B2CUser } from '../types/user'

export const GUEST_ID_PREFIX = 'guest-'
export const GUEST_DISPLAY_NAME = 'Invitado'

export const createGuestId = () => GUEST_ID_PREFIX + crypto.randomUUID()
export const isGuestId = (id: string) => id.startsWith(GUEST_ID_PREFIX)

/** Comprador invitado con el mismo contrato público que una identidad B2C resuelta. */
export const guestPurchaser = (id: string): B2CUser => ({ id, displayName: GUEST_DISPLAY_NAME, role: 'B2C' })

/** Header de identidad por tipo: el Server nunca resuelve un invitado como usuario del directorio. */
export const identityHeaders = (id: string): Record<string, string> =>
  isGuestId(id) ? { 'X-CiberNova-Guest-Id': id } : { 'X-CiberNova-User-Id': id }
