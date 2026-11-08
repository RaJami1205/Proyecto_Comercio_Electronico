/** Relaciona la identidad resuelta con su contexto comercial, sin calcular precios ni permisos. */
import type { BranchId } from './branch.js'
import type { AdminUser, B2BUser, B2CUser } from './user.js'

export type PricingType = 'RETAIL' | 'WHOLESALE'

/** pricingType discrimina las variantes sin duplicar el role de user; null excluye compras de ADMIN. */
export type CommercialContext =
  | {
    user: B2CUser
    pricingType: 'RETAIL'
    branchId: BranchId | null
  }
  | {
    user: B2BUser
    pricingType: 'WHOLESALE'
    branchId: BranchId | null
  }
  | {
    user: AdminUser
    pricingType: null
    branchId: null
  }
