/** Clasifica fallos de la proyección orders sin conservar mensajes del SDK, credenciales ni datos de la Order. */
export type OrderIndexFailure = 'configuration' | 'unavailable' | 'rejected' | 'invalid-record'
export type OrderIndexErrorKind = OrderIndexFailure | 'persistence'

const messages: Record<OrderIndexErrorKind, string> = {
  configuration: 'El índice orders no está configurado correctamente.',
  unavailable: 'Algolia no está disponible para sincronizar la Order.',
  rejected: 'Algolia rechazó la sincronización de la Order.',
  'invalid-record': 'La Order persistida no produce un registro indexable válido.',
  persistence: 'PostgreSQL no está disponible para registrar la sincronización.',
}

export class OrderIndexError extends Error {
  /** Solo los fallos temporales justifican reintentar dentro del mismo proceso. */
  readonly retryable: boolean
  constructor(public readonly kind: OrderIndexErrorKind) {
    super(messages[kind])
    this.name = 'OrderIndexError'
    this.retryable = kind === 'unavailable' || kind === 'persistence'
  }
}
