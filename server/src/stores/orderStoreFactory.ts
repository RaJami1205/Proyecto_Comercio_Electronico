/** Selección explícita por composición Server-side. Nunca interpreta variables de entorno ni hace fallback. */
import { InMemoryOrderStore, type OrderStore } from './orderStore.js'
import { PostgreSQLOrderStore } from './postgreSQLOrderStore.js'
import type { Database } from '../db/pool.js'
import { DatabaseError } from '../db/databaseError.js'

export function createOrderStore(kind: 'memory' | 'postgresql' = 'memory', db?: Database): OrderStore {
  if (kind !== 'memory' && kind !== 'postgresql') throw new DatabaseError('configuration')
  return kind === 'postgresql' ? new PostgreSQLOrderStore(db) : new InMemoryOrderStore()
}
