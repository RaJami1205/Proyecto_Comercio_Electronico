/** Define la identidad resuelta de la simulación, independiente de los datos de comprador. */
export type UserId = string

export type UserRole = 'B2C' | 'B2B' | 'ADMIN'

export interface Company {
  id: string
  name: string
}

interface UserIdentity {
  id: UserId
  displayName: string
}

export interface B2CUser extends UserIdentity {
  role: 'B2C'
  company?: never
}

export interface B2BUser extends UserIdentity {
  role: 'B2B'
  company: Company
}

export interface AdminUser extends UserIdentity {
  role: 'ADMIN'
  company?: never
}

export type ResolvedUser = B2CUser | B2BUser | AdminUser
