/** Carga las sucursales públicas y mantiene la selección solamente en memoria React. */
import { useEffect, useState, type ReactNode } from 'react'
import { BranchContext } from './BranchContext'
import { getBranches } from '../services/productApi'
import type { Branch, BranchId } from '../types/branch'

export default function BranchProvider({ children }: { children: ReactNode }) {
  const [branches, setBranches] = useState<Branch[]>([])
  const [selectedBranchId, setSelectedBranchId] = useState<BranchId | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    getBranches().then((result) => {
      if (cancelled) return
      setBranches(result)
      setSelectedBranchId(current => current && result.some(branch => branch.id === current && branch.available) ? current : null)
      setError(null)
    }).catch(() => {
      if (!cancelled) { setBranches([]); setSelectedBranchId(null); setError('No se pudieron cargar las sucursales. Intenta de nuevo.') }
    }).finally(() => { if (!cancelled) setIsLoading(false) })
    return () => { cancelled = true }
  }, [])

  function selectBranch(branchId: BranchId | null) {
    if (branchId !== null && !branches.some(branch => branch.id === branchId && branch.available)) return
    setSelectedBranchId(branchId)
  }

  return <BranchContext.Provider value={{ branches, selectedBranchId, setSelectedBranchId: selectBranch, isLoading, error }}>
    {children}
  </BranchContext.Provider>
}
