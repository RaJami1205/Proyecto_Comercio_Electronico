/**
 * Política central de RBAC y Order Ownership basada en Simulated Login.
 * No es autenticación segura de producción: la identidad proviene del header X-CiberNova-User-Id validado por UserService.
 */
import { UserError } from './userError.js'
import type { ResolvedUser, UserId, UserRole } from '../types/user.js'

/**
 * Permisos de la matriz RBAC. Payment reutiliza checkout:create junto con la propiedad de la Order.
 * catalog:read:admin (CN-67) habilita la consulta Read-Only de precios e inventario por sucursal.
 */
export type Permission = 'checkout:create' | 'orders:read:own' | 'orders:read:all' | 'catalog:read:admin'

export const ROLE_PERMISSIONS: Readonly<Record<UserRole, readonly Permission[]>> = Object.freeze({
  B2C: Object.freeze(['checkout:create', 'orders:read:own'] as const),
  B2B: Object.freeze(['checkout:create', 'orders:read:own'] as const),
  ADMIN: Object.freeze(['orders:read:all', 'catalog:read:admin'] as const),
})

/** Indica si el rol resuelto por UserService concede el permiso solicitado. */
export function hasPermission(user: ResolvedUser, permission: Permission): boolean {
  return ROLE_PERMISSIONS[user.role].includes(permission)
}

/** Rechaza con 403 cuando el usuario no tiene ninguno de los permisos indicados. */
export function requireAnyPermission(user: ResolvedUser, ...permissions: Permission[]): void {
  if (!permissions.some(permission => hasPermission(user, permission))) {
    throw new UserError(403, 'FORBIDDEN', 'Esta identidad no tiene permiso para realizar la operación.')
  }
}

/** Alcance de lectura reutilizable por la consulta individual, el historial propio y la consulta administrativa. */
export type OrderReadScope = { kind: 'all' } | { kind: 'own'; ownerId: UserId }

/** ADMIN consulta cualquier Order; B2C y B2B quedan limitados a su propio userId autoritativo. */
export function orderReadScope(user: ResolvedUser): OrderReadScope {
  if (hasPermission(user, 'orders:read:all')) return { kind: 'all' }
  requireAnyPermission(user, 'orders:read:own')
  return { kind: 'own', ownerId: user.id }
}

/**
 * Decide el acceso a una Order según el propietario almacenado en la persistencia.
 * Una Order sin propietario verificable nunca se concede a un comprador ni se asigna al usuario activo.
 */
export function canReadOrder(user: ResolvedUser, storedOwnerId: string | null | undefined): boolean {
  if (hasPermission(user, 'orders:read:all')) return true
  return hasPermission(user, 'orders:read:own')
    && typeof storedOwnerId === 'string' && storedOwnerId.length > 0 && storedOwnerId === user.id
}

/** Payment exige permiso de compra; ADMIN puede consultar Orders pero nunca procesar Payments. */
export function requirePaymentActor(user: ResolvedUser): UserId {
  requireAnyPermission(user, 'checkout:create')
  return user.id
}
