/** Única pareja comercial activa; PostgreSQL se habilita explícitamente para Orders y Payments juntos. */
import { serverConfig } from '../config/env.js'
import { orderStore } from './orderStore.js'
import { InMemoryPaymentStore } from './paymentStore.js'

export const commerceStores = serverConfig.commerceStoreMode === 'postgresql'
  ? (await import('./commerceStoreFactory.js')).createCommerceStores('postgresql')
  : Object.freeze({ orders: orderStore, payments: new InMemoryPaymentStore(orderStore) })
