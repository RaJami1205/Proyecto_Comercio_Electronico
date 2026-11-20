/** Selección coordinada, explícita y lazy. Tener DATABASE_URL nunca selecciona PostgreSQL. */
import { database, type Database } from '../db/pool.js'
import { createOrderStore } from './orderStoreFactory.js'
import { InMemoryPaymentStore } from './paymentStore.js'
import { PostgreSQLOrderStore } from './postgreSQLOrderStore.js'
import { PostgreSQLPaymentStore } from './postgreSQLPaymentStore.js'

export function createCommerceStores(kind: 'memory' | 'postgresql' = 'memory', db: Database = database) {
  const orders = createOrderStore(kind, db)
  const payments = orders instanceof PostgreSQLOrderStore ? new PostgreSQLPaymentStore(orders, db) : new InMemoryPaymentStore(orders)
  return { orders, payments }
}
