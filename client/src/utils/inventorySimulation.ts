/**
 * Inventory Simulation (CN-68): estado demostrativo de existencias por sucursal, solo en memoria de React.
 * Nunca se persiste ni se envía al Server, y no modifica los DTO recibidos: Algolia sigue siendo la fuente autoritativa.
 */
import { BRANCH_IDS, type BranchId } from '../types/branch'

/** Mismo rango de representación segura que el inventario autoritativo. */
export const MAX_SIMULATED_QUANTITY = Number.MAX_SAFE_INTEGER

export interface InventorySimulationEntry {
  productId: string
  branchId: BranchId
  /** Cantidad autoritativa recibida del Server al confirmar; nunca se sobrescribe. */
  originalQuantity: number
  simulatedQuantity: number
  status: 'applied'
}

/** ownerId vincula las simulaciones a una identidad; otra Session nunca las hereda. */
export interface InventorySimulationState {
  ownerId: string | null
  entries: Readonly<Record<string, InventorySimulationEntry>>
}

export type InventorySimulationAction =
  | { type: 'apply'; ownerId: string; productId: string; branchId: BranchId; originalQuantity: number; simulatedQuantity: number }
  | { type: 'reset'; ownerId: string; productId: string; branchId: BranchId }
  | { type: 'reset-product'; ownerId: string; productId: string }
  | { type: 'reset-all' }

export const EMPTY_SIMULATION: InventorySimulationState = Object.freeze({ ownerId: null, entries: Object.freeze({}) })

export const simulationKey = (productId: string, branchId: BranchId) => JSON.stringify([productId, branchId])

/** Original y propuesta comparten representación numérica, sin coerciones ni límites demostrativos. */
export const isInventoryQuantity = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0

/** Guarda común para el formulario y el reducer; el original siempre procede del DTO del Server. */
export function isValidSimulationApplication(action: Extract<InventorySimulationAction, { type: 'apply' }>): boolean {
  return typeof action.ownerId === 'string' && action.ownerId.trim().length > 0
    && typeof action.productId === 'string' && action.productId.trim().length > 0
    && (BRANCH_IDS as readonly string[]).includes(action.branchId)
    && isInventoryQuantity(action.originalQuantity) && isInventoryQuantity(action.simulatedQuantity)
}

export type QuantityValidation = { ok: true; value: number } | { ok: false; message: string }

/** Acepta solo enteros decimales sin signo; cero es válido y representa una sucursal agotada. */
export function validateSimulatedQuantity(raw: string): QuantityValidation {
  const text = raw.trim()
  if (!text) return { ok: false, message: 'Ingresa una cantidad.' }
  if (/^-/.test(text)) return { ok: false, message: 'La cantidad no puede ser negativa.' }
  if (/^\d*[.,]\d+$/.test(text)) return { ok: false, message: 'La cantidad debe ser un número entero.' }
  if (!/^\d+$/.test(text)) return { ok: false, message: 'Ingresa solo dígitos, sin signos ni letras.' }
  const value = Number(text)
  if (!isInventoryQuantity(value)) return { ok: false, message: `La cantidad máxima de simulación es ${MAX_SIMULATED_QUANTITY.toLocaleString('es-CR')} unidades.` }
  return { ok: true, value }
}

/** Una acción de otra identidad parte de un estado vacío en lugar de reutilizar simulaciones previas. */
function forOwner(state: InventorySimulationState, ownerId: string): InventorySimulationState {
  return state.ownerId === ownerId ? state : { ownerId, entries: {} }
}

/** Reducer puro: crea objetos nuevos y rechaza datos originales o sucursales inválidas. */
export function inventorySimulationReducer(state: InventorySimulationState, action: InventorySimulationAction): InventorySimulationState {
  if (action.type === 'reset-all') return state.ownerId === null && !Object.keys(state.entries).length ? state : EMPTY_SIMULATION
  const current = forOwner(state, action.ownerId)
  if (action.type === 'apply') {
    if (!isValidSimulationApplication(action)) return current
    const entry: InventorySimulationEntry = { productId: action.productId, branchId: action.branchId,
      originalQuantity: action.originalQuantity, simulatedQuantity: action.simulatedQuantity, status: 'applied' }
    return { ownerId: current.ownerId, entries: { ...current.entries, [simulationKey(action.productId, action.branchId)]: entry } }
  }
  const entries = Object.fromEntries(Object.entries(current.entries).filter(([, entry]) => action.type === 'reset'
    ? !(entry.productId === action.productId && entry.branchId === action.branchId)
    : entry.productId !== action.productId))
  return { ownerId: current.ownerId, entries }
}

/** Simulaciones vigentes de un producto para la identidad activa, en el orden estable de sucursales. */
export function simulationsFor(state: InventorySimulationState, ownerId: string | undefined, productId: string): InventorySimulationEntry[] {
  if (!ownerId || state.ownerId !== ownerId) return []
  return BRANCH_IDS.map(branchId => state.entries[simulationKey(productId, branchId)]).filter((entry): entry is InventorySimulationEntry => entry !== undefined)
}

export type SimulationChange = 'increase' | 'decrease' | 'unchanged'
export const simulationChange = (entry: Pick<InventorySimulationEntry, 'originalQuantity' | 'simulatedQuantity'>): SimulationChange =>
  entry.simulatedQuantity > entry.originalQuantity ? 'increase' : entry.simulatedQuantity < entry.originalQuantity ? 'decrease' : 'unchanged'
