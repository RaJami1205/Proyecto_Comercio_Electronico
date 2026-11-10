/** Única pareja comercial activa. La activación PostgreSQL requiere reemplazar la pareja completa y validarla. */
import { orderStore } from './orderStore.js'
import { InMemoryPaymentStore } from './paymentStore.js'

export const commerceStores = Object.freeze({ orders: orderStore, payments: new InMemoryPaymentStore(orderStore) })
