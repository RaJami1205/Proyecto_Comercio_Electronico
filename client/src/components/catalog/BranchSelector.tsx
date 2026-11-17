/** Selector accesible de sucursal con estado de carga, error y contexto de inventario informativo. */
import { useBranch } from '../../hooks/useBranch'
import styles from '../../styles/catalog/BranchSelector.module.css'

function BranchSelector() {
  const { branches, selectedBranchId, setSelectedBranchId, isLoading, error } = useBranch()
  return (
    <section className={styles.panel} aria-label="Disponibilidad por sucursal">
      <div className={styles.copy}>
        <p className={styles.eyebrow}>Disponibilidad local</p>
        <h2>Elige una sucursal</h2>
        <p>Consulta las existencias por ubicación. La selección no se guarda en el navegador.</p>
      </div>
      <div className={styles.control}>
        <label htmlFor="branch-selector">Sucursal de consulta</label>
        <select id="branch-selector" value={selectedBranchId ?? ''} disabled={isLoading || Boolean(error)}
          aria-busy={isLoading} onChange={event => setSelectedBranchId(event.target.value ? event.target.value as typeof selectedBranchId : null)}>
          <option value="">Selecciona una sucursal</option>
          {branches.map(branch => <option key={branch.id} value={branch.id} disabled={!branch.available}>
            {branch.name}{branch.available ? '' : ' · No disponible'}
          </option>)}
        </select>
        {isLoading ? <p className={styles.status} role="status">Cargando sucursales…</p> : null}
        {error ? <p className={styles.error} role="alert">{error}</p> : null}
        {!isLoading && !error ? <p className={styles.notice} role="note">La disponibilidad se confirma nuevamente al crear la orden.</p> : null}
      </div>
    </section>
  )
}

export default BranchSelector
