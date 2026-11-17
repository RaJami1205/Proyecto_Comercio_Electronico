import { useContext } from 'react'
import { BranchContext } from '../context/BranchContext'

export function useBranch() {
  const branch = useContext(BranchContext)
  if (branch === undefined) throw new Error('useBranch must be used within a BranchProvider')
  return branch
}
