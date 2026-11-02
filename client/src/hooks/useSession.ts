import { useContext } from 'react'
import { SessionContext } from '../context/SessionContext'

export function useSession() {
  const session = useContext(SessionContext)
  if (session === undefined) throw new Error('useSession must be used within a SessionProvider')
  return session
}
