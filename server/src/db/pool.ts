/** Posee un Pool reutilizable y lazy por instancia. Importar el singleton no construye un Pool ni abre conexiones. */
import { Pool, type PoolClient, type PoolConfig, type QueryResult } from 'pg'
import { getDatabaseConfig } from '../config/database.js'
import { DatabaseError, databaseError } from './databaseError.js'
import { withTransaction } from './transaction.js'

export class Database {
  private pool?: Pool
  private closing?: Promise<void>
  private closed = false

  /** Las factories permiten probar lifecycle y fallos sin conexiones ni configuración reales. */
  constructor(private readonly configuration: () => PoolConfig = getDatabaseConfig,
    private readonly createPool: (config: PoolConfig) => Pool = config => new Pool(config)) {}

  /** Configura una única instancia en el primer uso explícito y captura errores de clients ociosos. */
  private getPool(): Pool {
    if (this.closed) throw new DatabaseError('closed')
    if (!this.pool) {
      this.pool = this.createPool(this.configuration())
      this.pool.on('error', () => { console.error('Se descartó una conexión ociosa de PostgreSQL.') })
    }
    return this.pool
  }

  /** Presta un client del mismo Pool. El consumidor debe liberarlo, incluso ante errores. */
  async connect(): Promise<PoolClient> {
    try { return await this.getPool().connect() }
    catch (error) { throw databaseError(error, 'not-committed', 'unavailable') }
  }

  /** Ejecuta SQL interno con parámetros posicionales. Conserva los parsers NUMERIC originales de pg. */
  async query<Row extends Record<string, unknown> = Record<string, unknown>>(sql: string, parameters: readonly unknown[] = []): Promise<QueryResult<Row>> {
    try { return await this.getPool().query<Row>(sql, [...parameters]) }
    catch (error) { throw databaseError(error, 'not-committed', 'unavailable') }
  }

  /** Comparte un único client entre todas las sentencias del callback transaccional. */
  async transaction<T>(operation: (client: PoolClient) => Promise<T>): Promise<T> {
    try { return await withTransaction(this.getPool(), operation) }
    catch (error) { throw databaseError(error) }
  }

  /** Cierra una vez y espera los clients prestados. Cerrar una instancia sin usar no inicializa el Pool. */
  close(): Promise<void> {
    this.closed = true
    const pool = this.pool
    if (!pool) return Promise.resolve()
    this.closing ??= Promise.resolve().then(() => pool.end()).catch(error => { throw databaseError(error, 'not-committed', 'unavailable') })
    return this.closing
  }
}

export const database = new Database()
