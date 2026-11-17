/** Estado compartido y no persistente de la sucursal activa para consultas de inventario. */
import { createContext } from 'react'
import type { Branch, BranchId } from '../types/branch'

export interface BranchContextValue {
  branches: Branch[]
  selectedBranchId: BranchId | null
  setSelectedBranchId: (branchId: BranchId | null) => void
  isLoading: boolean
  error: string | null
}

export const BranchContext = createContext<BranchContextValue | undefined>(undefined)
