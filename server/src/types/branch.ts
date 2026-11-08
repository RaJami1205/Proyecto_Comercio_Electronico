/** Separa los identificadores estables de sucursal de sus nombres visibles. */
export type BranchId = 'san_jose' | 'alajuela' | 'cartago' | 'heredia'

export interface Branch {
  id: BranchId
  name: string
}
