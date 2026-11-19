/**
 * Inventory Simulation (CN-68): formulario, confirmación, comparación Original vs Simulated y Reset.
 * Solo despacha acciones al estado en memoria de App; no realiza requests ni modifica el producto recibido.
 */
import { useState, type FormEvent } from 'react'
import type { AdminProduct } from '../../types/adminProduct'
import type { BranchId } from '../../types/branch'
import { formatUnits } from '../../utils/adminProductFormat'
import {
  simulationChange, validateSimulatedQuantity, type InventorySimulationAction, type InventorySimulationEntry,
} from '../../utils/inventorySimulation'
import { Badge } from './AdminShell'
import styles from '../../styles/admin/AdminProducts.module.css'

interface PendingSimulation { branchId: BranchId; branchName: string; originalQuantity: number; simulatedQuantity: number }

const difference = (entry: Pick<InventorySimulationEntry, 'originalQuantity' | 'simulatedQuantity'>) => {
  const delta = entry.simulatedQuantity - entry.originalQuantity
  return delta > 0 ? `+${delta}` : String(delta)
}
const CHANGE_LABELS = { increase: 'Incremento', decrease: 'Reducción', unchanged: 'Sin cambio' } as const

export default function InventorySimulationPanel({ product, ownerId, entries, onSimulationChange }: {
  product: AdminProduct
  ownerId: string
  entries: InventorySimulationEntry[]
  onSimulationChange: (action: InventorySimulationAction) => void
}) {
  const [branchId, setBranchId] = useState<BranchId | ''>('')
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState<PendingSimulation | null>(null)
  const [feedback, setFeedback] = useState<string | null>(null)

  const branch = product.inventory.branches.find(item => item.branchId === branchId)
  const originalAvailable = branch !== undefined && branch.quantity !== null && branch.status !== 'invalid'
  const current = entries.find(entry => entry.branchId === branchId)

  function review(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setFeedback(null)
    if (!branch) { setError('Selecciona una sucursal válida.'); return }
    if (!originalAvailable || branch.quantity === null) { setError('El inventario original de esta sucursal no está disponible; no se puede simular.'); return }
    const validation = validateSimulatedQuantity(draft)
    if (!validation.ok) { setError(validation.message); return }
    setError(null)
    setPending({ branchId: branch.branchId, branchName: branch.name, originalQuantity: branch.quantity, simulatedQuantity: validation.value })
  }

  function confirm() {
    if (!pending) return
    // La cantidad original se vuelve a leer del producto recibido del Server en el momento de confirmar.
    const authoritative = product.inventory.branches.find(item => item.branchId === pending.branchId)
    if (!authoritative || authoritative.quantity !== pending.originalQuantity) {
      setPending(null)
      setError('El inventario original cambió o no está disponible. Revisa la simulación nuevamente.')
      return
    }
    onSimulationChange({ type: 'apply', ownerId, productId: product.id, branchId: pending.branchId,
      originalQuantity: pending.originalQuantity, simulatedQuantity: pending.simulatedQuantity })
    setFeedback(`Simulación aplicada en ${pending.branchName}: ${formatUnits(pending.originalQuantity)} → ${formatUnits(pending.simulatedQuantity)} `
      + `(${difference(pending)}). Es una simulación local: Algolia, PostgreSQL y el Server no se modificaron.`)
    setPending(null)
    setDraft('')
  }

  function discard() {
    setPending(null)
    setFeedback('Se descartó la modificación pendiente. No se aplicó ningún cambio.')
  }

  function reset(entry: InventorySimulationEntry, branchName: string) {
    onSimulationChange({ type: 'reset', ownerId, productId: product.id, branchId: entry.branchId })
    setFeedback(`Se restableció ${branchName} a su inventario original: ${formatUnits(entry.originalQuantity)}.`)
  }

  function resetProduct() {
    onSimulationChange({ type: 'reset-product', ownerId, productId: product.id })
    setPending(null)
    setFeedback('Se restablecieron todas las sucursales de este producto a su inventario original.')
  }

  const branchName = (id: BranchId) => product.inventory.branches.find(item => item.branchId === id)?.name ?? id

  return (
    <section className={styles.simulation} aria-labelledby="inventory-simulation-title">
      <p className={styles.simulationTag}>Inventory Simulation · Modo demostrativo</p>
      <h2 id="inventory-simulation-title">Simular existencias por sucursal</h2>
      <p className={styles.hint}>
        Los valores simulados solo existen en esta pestaña y se pierden al recargar o cambiar de sesión. No modifican Algolia, PostgreSQL
        ni el inventario que usan el catálogo, el carrito, el checkout o las órdenes.
      </p>

      {pending ? (
        <div className={styles.confirmation} role="alertdialog" aria-labelledby="simulation-confirm-title" aria-describedby="simulation-confirm-note">
          <h3 id="simulation-confirm-title">Confirma la simulación</h3>
          <dl className={styles.info}>
            <div><dt>Producto</dt><dd>{product.title}</dd></div>
            <div><dt>Sucursal</dt><dd>{pending.branchName}</dd></div>
            <div><dt>Original Stock (Server)</dt><dd>{formatUnits(pending.originalQuantity)}</dd></div>
            <div><dt>Simulated Stock propuesto</dt><dd>{formatUnits(pending.simulatedQuantity)} ({CHANGE_LABELS[simulationChange(pending)]}, {difference(pending)})</dd></div>
          </dl>
          <p id="simulation-confirm-note" className={styles.hint}>Esta operación es exclusivamente simulada: no envía datos al Server ni actualiza el inventario real.</p>
          <div className={styles.actions}>
            <button type="button" className={styles.primaryButton} onClick={confirm}>Confirmar simulación</button>
            <button type="button" className={styles.secondaryButton} onClick={discard}>Descartar cambio</button>
          </div>
        </div>
      ) : (
        <form className={styles.simulationForm} onSubmit={review} noValidate aria-label="Nueva cantidad simulada">
          <label>
            <span>Sucursal</span>
            <select value={branchId} onChange={event => { setBranchId(event.target.value as BranchId | ''); setError(null); setFeedback(null) }}>
              <option value="">Selecciona una sucursal</option>
              {product.inventory.branches.map(item => <option key={item.branchId} value={item.branchId}>{item.name}</option>)}
            </select>
          </label>
          <p className={styles.originalQuantity} aria-live="polite">
            Cantidad original (Server): <strong>{branch ? formatUnits(branch.quantity) : 'Selecciona una sucursal'}</strong>
            {current ? <> · Simulada actual: <strong>{formatUnits(current.simulatedQuantity)}</strong></> : null}
          </p>
          <label>
            <span>Nueva cantidad simulada</span>
            <input type="text" inputMode="numeric" autoComplete="off" value={draft} maxLength={9}
              aria-invalid={error ? true : undefined} aria-describedby={error ? 'simulation-error' : undefined}
              onChange={event => { setDraft(event.target.value); setError(null) }} placeholder="Ej. 25 (0 representa agotado)" />
          </label>
          <button type="submit" className={styles.primaryButton} disabled={branchId === '' || (branch !== undefined && !originalAvailable)}>Revisar simulación</button>
          {branch && !originalAvailable ? <p className={styles.fieldError} role="alert">El inventario original de {branch.name} no está disponible; no se puede simular.</p> : null}
          {error ? <p id="simulation-error" className={styles.fieldError} role="alert">{error}</p> : null}
        </form>
      )}

      {feedback ? <p className={styles.simulationFeedback} role="status">{feedback}</p> : null}

      {entries.length ? (
        <div className={styles.comparison}>
          <h3>Original vs Simulated</h3>
          <table className={styles.branches}>
            <caption className={styles.visuallyHidden}>Comparación de inventario original y simulado de {product.title}</caption>
            <thead>
              <tr><th scope="col">Sucursal</th><th scope="col">Original Stock</th><th scope="col">Simulated Stock</th><th scope="col">Cambio</th><th scope="col"><span className={styles.visuallyHidden}>Acción</span></th></tr>
            </thead>
            <tbody>
              {entries.map(entry => (
                <tr key={entry.branchId}>
                  <th scope="row" data-label="Sucursal">{branchName(entry.branchId)}</th>
                  <td data-label="Original Stock">{formatUnits(entry.originalQuantity)}</td>
                  <td data-label="Simulated Stock"><Badge tone="warning">{formatUnits(entry.simulatedQuantity)} · simulado</Badge></td>
                  <td data-label="Cambio">{CHANGE_LABELS[simulationChange(entry)]} ({difference(entry)})</td>
                  <td data-label="Acción">
                    <button type="button" className={styles.secondaryButton} onClick={() => reset(entry, branchName(entry.branchId))}
                      aria-label={`Restablecer ${branchName(entry.branchId)} al inventario original`}>Restablecer</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className={styles.actions}>
            <button type="button" className={styles.secondaryButton} onClick={resetProduct}>Restablecer simulación del producto</button>
          </div>
        </div>
      ) : null}
    </section>
  )
}
