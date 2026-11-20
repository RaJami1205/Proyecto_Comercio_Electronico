/**
 * Inventory Simulation (CN-68): formulario, confirmación, comparación Original vs Simulated y Reset.
 * Solo despacha acciones al estado en memoria de App; no realiza requests ni modifica el producto recibido.
 */
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useSession } from '../../hooks/useSession'
import type { AdminProduct } from '../../types/adminProduct'
import { BRANCH_IDS, type BranchId } from '../../types/branch'
import { formatUnits } from '../../utils/adminProductFormat'
import {
  isInventoryQuantity, isValidSimulationApplication, MAX_SIMULATED_QUANTITY, simulationChange, validateSimulatedQuantity,
  type InventorySimulationAction, type InventorySimulationEntry,
} from '../../utils/inventorySimulation'
import { Badge } from './AdminShell'
import styles from '../../styles/admin/AdminProducts.module.css'

interface PendingSimulation {
  ownerId: string; epoch: number; productId: string; branchId: BranchId; branchName: string
  originalQuantity: number; simulatedQuantity: number
}
interface SubmittedSimulation extends PendingSimulation { previousEntry: InventorySimulationEntry | undefined }

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
  const { user, epoch } = useSession()
  const scope = JSON.stringify([ownerId, user?.id, user?.role, epoch, product.id])
  const [editorScope, setEditorScope] = useState(scope)
  const [branchId, setBranchId] = useState<BranchId | ''>('')
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState<PendingSimulation | null>(null)
  const [submitted, setSubmitted] = useState<SubmittedSimulation | null>(null)
  const [feedback, setFeedback] = useState<string | null>(null)
  // Solo protege el consumo de la confirmación; las cantidades aplicadas pertenecen al reducer de App.
  const reviewed = useRef<PendingSimulation | null>(null)
  useEffect(() => () => { reviewed.current = null }, [scope])

  if (editorScope !== scope) {
    setEditorScope(scope)
    setBranchId('')
    setDraft('')
    setError(null)
    setPending(null)
    setSubmitted(null)
    setFeedback(null)
  }

  const branch = product.inventory.branches.find(item => item.branchId === branchId)
  const authorized = user?.role === 'ADMIN' && user.id === ownerId
  const originalAvailable = branch !== undefined && isInventoryQuantity(branch.quantity) && branch.status !== 'invalid'
  const current = entries.find(entry => entry.branchId === branchId)
  const applied = submitted && authorized && submitted.ownerId === ownerId && submitted.epoch === epoch
    && submitted.productId === product.id && entries.some(entry => entry !== submitted.previousEntry
      && entry.status === 'applied' && entry.productId === submitted.productId && entry.branchId === submitted.branchId
      && entry.originalQuantity === submitted.originalQuantity && entry.simulatedQuantity === submitted.simulatedQuantity)
  // Se deriva del estado recibido después del render de App, nunca del retorno de dispatch.
  const displayFeedback = applied && submitted
    ? `Simulación aplicada en ${submitted.branchName}: ${formatUnits(submitted.originalQuantity)} → ${formatUnits(submitted.simulatedQuantity)} `
      + `(${difference(submitted)}). Es una simulación local: Algolia, PostgreSQL y el Server no se modificaron.`
    : feedback
  const displayError = error ?? (submitted && !applied ? 'No se pudo aplicar la simulación. Revisa los datos e inténtalo nuevamente.' : null)

  function review(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setFeedback(null)
    setSubmitted(null)
    reviewed.current = null
    if (!authorized) { setError('La sesión ADMIN ya no está vigente.'); return }
    if (!branch || !(BRANCH_IDS as readonly string[]).includes(branch.branchId)) { setError('Selecciona una sucursal válida.'); return }
    if (!originalAvailable || !isInventoryQuantity(branch.quantity)) { setError('El inventario original de esta sucursal no está disponible; no se puede simular.'); return }
    const validation = validateSimulatedQuantity(draft)
    if (!validation.ok) { setError(validation.message); return }
    setError(null)
    const proposal: PendingSimulation = { ownerId, epoch, productId: product.id,
      branchId: branch.branchId, branchName: branch.name, originalQuantity: branch.quantity, simulatedQuantity: validation.value }
    reviewed.current = proposal
    setPending(proposal)
  }

  function confirm() {
    if (!pending || reviewed.current !== pending) return
    reviewed.current = null
    if (!authorized || pending.ownerId !== ownerId || pending.epoch !== epoch || pending.productId !== product.id || pending.branchId !== branchId) {
      setPending(null)
      setError('El contexto de la simulación cambió. Revisa los datos nuevamente.')
      return
    }
    // La cantidad original se vuelve a leer del producto recibido del Server en el momento de confirmar.
    const authoritative = product.inventory.branches.find(item => item.branchId === pending.branchId)
    const action: Extract<InventorySimulationAction, { type: 'apply' }> = { type: 'apply', ownerId, productId: product.id,
      branchId: pending.branchId, originalQuantity: pending.originalQuantity, simulatedQuantity: pending.simulatedQuantity }
    if (!authoritative || authoritative.status === 'invalid' || !isInventoryQuantity(authoritative.quantity)
      || authoritative.quantity !== pending.originalQuantity || !isValidSimulationApplication(action)) {
      setPending(null)
      setError('El inventario original cambió o no está disponible. Revisa la simulación nuevamente.')
      return
    }
    setFeedback(null)
    setSubmitted({ ...pending, previousEntry: entries.find(entry => entry.productId === product.id && entry.branchId === pending.branchId) })
    onSimulationChange(action)
    setPending(null)
    setDraft('')
  }

  function discard() {
    reviewed.current = null
    setSubmitted(null)
    setPending(null)
    setFeedback('Se descartó la modificación pendiente. No se aplicó ningún cambio.')
  }

  function reset(entry: InventorySimulationEntry, branchName: string) {
    setSubmitted(null)
    onSimulationChange({ type: 'reset', ownerId, productId: product.id, branchId: entry.branchId })
    setFeedback(`Simulación descartada en ${branchName}. Se muestra nuevamente el inventario consultado.`)
  }

  function resetProduct() {
    reviewed.current = null
    setSubmitted(null)
    onSimulationChange({ type: 'reset-product', ownerId, productId: product.id })
    setPending(null)
    setFeedback('Se descartaron las simulaciones de este producto. Se muestra nuevamente el inventario consultado.')
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
            <select value={branchId} onChange={event => {
              reviewed.current = null; setPending(null); setSubmitted(null)
              setBranchId(event.target.value as BranchId | ''); setError(null); setFeedback(null)
            }}>
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
            <input type="text" inputMode="numeric" autoComplete="off" value={draft} maxLength={String(MAX_SIMULATED_QUANTITY).length}
              aria-invalid={displayError ? true : undefined} aria-describedby={displayError ? 'simulation-error' : undefined}
              onChange={event => { setDraft(event.target.value); setError(null); setSubmitted(null) }} placeholder="Ej. 25 (0 representa agotado)" />
          </label>
          <button type="submit" className={styles.primaryButton} disabled={!authorized || branchId === '' || (branch !== undefined && !originalAvailable)}>Revisar simulación</button>
          {branch && !originalAvailable ? <p className={styles.fieldError} role="alert">El inventario original de {branch.name} no está disponible; no se puede simular.</p> : null}
          {displayError ? <p id="simulation-error" className={styles.fieldError} role="alert">{displayError}</p> : null}
        </form>
      )}

      {displayFeedback ? <p className={styles.simulationFeedback} role="status">{displayFeedback}</p> : null}

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
