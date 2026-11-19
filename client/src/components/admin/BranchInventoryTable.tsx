/** Inventario de las cuatro sucursales; en móvil la tabla se presenta como filas etiquetadas. */
import type { AdminBranchInventory } from '../../types/adminProduct'
import type { InventorySimulationEntry } from '../../utils/inventorySimulation'
import { BRANCH_STATUS_LABELS, BRANCH_STATUS_TONES, formatUnits } from '../../utils/adminProductFormat'
import { Badge } from './AdminShell'
import styles from '../../styles/admin/AdminProducts.module.css'

export default function BranchInventoryTable({ branches, caption, highlight, simulated = [] }: {
  branches: AdminBranchInventory[]
  caption: string
  /** Sucursal filtrada en el listado, resaltada sin ocultar las demás. */
  highlight?: string
  /** CN-68: valores demostrativos en una columna aparte; Existencias y Estado conservan el dato del Server. */
  simulated?: InventorySimulationEntry[]
}) {
  const simulatedByBranch = new Map(simulated.map(entry => [entry.branchId, entry.simulatedQuantity]))
  return (
    <table className={styles.branches}>
      <caption className={styles.visuallyHidden}>{caption}</caption>
      <thead>
        <tr><th scope="col">Sucursal</th><th scope="col">Existencias</th><th scope="col">Estado</th>{simulated.length ? <th scope="col">Simulado</th> : null}</tr>
      </thead>
      <tbody>
        {branches.map(branch => (
          <tr key={branch.branchId} data-highlight={branch.branchId === highlight ? 'true' : undefined}>
            <th scope="row" data-label="Sucursal">{branch.name}</th>
            <td data-label="Existencias">{formatUnits(branch.quantity)}</td>
            <td data-label="Estado"><Badge tone={BRANCH_STATUS_TONES[branch.status]}>{BRANCH_STATUS_LABELS[branch.status]}</Badge></td>
            {simulated.length ? <td data-label="Simulado">{simulatedByBranch.has(branch.branchId)
              ? <Badge tone="warning">{formatUnits(simulatedByBranch.get(branch.branchId) ?? null)} · simulado</Badge> : 'Sin simulación'}</td> : null}
          </tr>
        ))}
      </tbody>
    </table>
  )
}
