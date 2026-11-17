/** Define los identificadores estables de las cuatro sucursales del catálogo. */
export const BRANCH_IDS = ['san_jose', 'alajuela', 'cartago', 'heredia'] as const
export type BranchId = typeof BRANCH_IDS[number]

export interface Branch {
  id: BranchId
  name: string
  available: boolean
}
