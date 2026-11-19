/** Inventario de las cuatro sucursales; en móvil la tabla se presenta como filas etiquetadas. */
import type { AdminBranchInventory } from '../../types/adminProduct'
import { BRANCH_STATUS_LABELS, BRANCH_STATUS_TONES, formatUnits } from '../../utils/adminProductFormat'
import { Badge } from './AdminShell'
import styles from '../../styles/admin/AdminProducts.module.css'

export default function BranchInventoryTable({ branches, caption, highlight }: {
  branches: AdminBranchInventory[]
  caption: string
  /** Sucursal filtrada en el listado, resaltada sin ocultar las demás. */
  highlight?: string
}) {
  return (
    <table className={styles.branches}>
      <caption className={styles.visuallyHidden}>{caption}</caption>
      <thead>
        <tr><th scope="col">Sucursal</th><th scope="col">Existencias</th><th scope="col">Estado</th></tr>
      </thead>
      <tbody>
        {branches.map(branch => (
          <tr key={branch.branchId} data-highlight={branch.branchId === highlight ? 'true' : undefined}>
            <th scope="row" data-label="Sucursal">{branch.name}</th>
            <td data-label="Existencias">{formatUnits(branch.quantity)}</td>
            <td data-label="Estado"><Badge tone={BRANCH_STATUS_TONES[branch.status]}>{BRANCH_STATUS_LABELS[branch.status]}</Badge></td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
