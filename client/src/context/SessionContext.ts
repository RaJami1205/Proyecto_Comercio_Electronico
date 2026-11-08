/** Estado exclusivamente en memoria y coordinación temporal de transiciones de identidad. */
import { createContext } from 'react'
import type { ResolvedUser } from '../types/user'

export type TransactionState = 'idle' | 'active' | 'known' | 'uncertain'
export type SessionDialogMode = 'login' | 'logout' | 'conflict' | null
export interface SessionTransition {
  user: ResolvedUser | null
  cartRevision: number
  kind: 'identity' | 'conflict'
}
export interface SessionState {
  user: ResolvedUser | null
  dialog: SessionDialogMode
  pending: SessionTransition | null
  resolving: boolean
  error: string | null
  epoch: number
  checkoutMounted: boolean
  transaction: TransactionState
}
export interface SessionContextValue extends SessionState {
  transitionBlockReason: string | null
  purchaseBlockReason: string | null
  openLogin: () => void
  requestLogout: () => void
  resolveUser: (userId: string) => Promise<void>
  confirmTransition: (consentRevision: number) => void
  cancelTransition: () => void
  resolveCartConflict: () => void
  setCheckoutMounted: (mounted: boolean) => void
  setTransactionState: (state: TransactionState) => void
  isTransactionBlocked: () => boolean
  getPurchaseBlockReason: () => string | null
}

export const SessionContext = createContext<SessionContextValue | undefined>(undefined)
