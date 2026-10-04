/** Presenta filtros controlados por la página usando facets y el árbol de categorías de la API. */
import { useState } from 'react'

import { useCategoryTree } from '../../hooks/useCategoryTree'
import type { CategoryTreeNode } from '../../services/productApi'
import type { CatalogFilters as CatalogFiltersState, SortOption } from '../../services/productApi'
import type { ActivePanel } from './CatalogToolbar'
import styles from '../../styles/catalog/CatalogFilters.module.css'

interface CatalogFiltersProps {
  facets: Record<string, Record<string, number>>
  filters: CatalogFiltersState
  onChange: (filters: CatalogFiltersState) => void
  isUpdating?: boolean
  activePanel: ActivePanel
}

const LEADING_BRANDS = [
  'Samsung',
  'ASUS',
  'Lenovo',
  'HP',
  'Dell',
  'Sony',
  'Intel',
  'AMD',
  'LG',
  'Logitech',
]

/** Obtiene los descendientes que deben deseleccionarse al retirar una categoría padre. */
function collectDescendantNames(node: CategoryTreeNode): string[] {
  return node.children.flatMap((child) => [child.name, ...collectDescendantNames(child)])
}

/** Presenta categorías jerárquicas según facets y selecciones activas. */
function CategoryTree({
  facetCounts,
  values,
  onChange,
}: {
  facetCounts: Record<string, number>
  values: string[]
  onChange: (values: string[]) => void
}) {
  const { tree, isLoading } = useCategoryTree()

  /** Conserva categorías disponibles o seleccionadas para permitir deshacer el filtro. */
  function isVisible(name: string): boolean {
    return facetCounts[name] !== undefined || values.includes(name)
  }

  /** Selecciona una categoría o retira también sus descendientes al desmarcarla. */
  function toggleSelect(node: CategoryTreeNode, checked: boolean) {
    if (checked) {
      onChange([...values, node.name])
      return
    }
    const descendants = collectDescendantNames(node)
    onChange(values.filter((value) => value !== node.name && !descendants.includes(value)))
  }

  /** Renderiza recursivamente las ramas visibles sin perder su jerarquía. */
  function renderNodes(nodes: CategoryTreeNode[]) {
    return nodes
      .filter((node) => isVisible(node.name))
      .map((node) => {
        const isChecked = values.includes(node.name)
        return (
          <div className={styles.categoryNode} key={node.name}>
            <label
              className={`${styles.checkOption} ${isChecked ? styles.isSelected : ''}`}
            >
              <input
                type="checkbox"
                checked={isChecked}
                onChange={(event) => toggleSelect(node, event.target.checked)}
              />
              <span>{node.name}</span>
              {facetCounts[node.name] !== undefined ? <small>{facetCounts[node.name]}</small> : null}
            </label>
            {isChecked && node.children.length > 0 ? (
              <div className={styles.categoryChildren}>{renderNodes(node.children)}</div>
            ) : null}
          </div>
        )
      })
  }

  return (
    <fieldset className={styles.group}>
      <legend>Categorías</legend>
      {isLoading ? (
        <p className={styles.leafNote}>Cargando categorías…</p>
      ) : (
        <div className={styles.categoryGrid}>{renderNodes(tree)}</div>
      )}
    </fieldset>
  )
}

/** Restringe las marcas iniciales a las destacadas y usa facets al seleccionar categoría. */
function BrandFilter({
  facets,
  categorySelected,
  values,
  onChange,
}: {
  facets: Record<string, Record<string, number>>
  categorySelected: boolean
  values: string[]
  onChange: (values: string[]) => void
}) {
  const brandFacets = facets.brand ?? {}
  const visibleEntries = Object.entries(brandFacets)
    .filter(([name]) => (categorySelected ? true : LEADING_BRANDS.includes(name)))
    .sort(([left], [right]) => left.localeCompare(right))

  if (visibleEntries.length === 0) return <p className={styles.leafNote}>No hay marcas disponibles.</p>

  return (
    <fieldset className={styles.group}>
      <legend>Marcas</legend>
      <div className={styles.brandGrid}>
        {visibleEntries.map(([value, count]) => {
          const isSelected = values.includes(value)
          const isDisabled = count === 0

          return (
            <label
              className={`${styles.checkOption} ${isSelected ? styles.isSelected : ''} ${isDisabled ? styles.isDisabled : ''}`}
              key={value}
            >
              <input
                type="checkbox"
                checked={isSelected}
                disabled={isDisabled}
                onChange={(event) => {
                  const nextValues = event.target.checked
                    ? [...values, value]
                    : values.filter((current) => current !== value)
                  onChange(nextValues)
                }}
              />
              <span>{value}</span>
              <small>{count}</small>
            </label>
          )
        })}
      </div>
    </fieldset>
  )
}

/** Mantiene el precio pendiente separado de los filtros aplicados y muestra el panel activo. */
function CatalogFilters({
  facets,
  filters,
  onChange,
  isUpdating = false,
  activePanel,
}: CatalogFiltersProps) {
  const [pendingMinPrice, setPendingMinPrice] = useState(filters.minPrice ?? '')
  const [pendingMaxPrice, setPendingMaxPrice] = useState(filters.maxPrice ?? '')

  const [prevMin, setPrevMin] = useState(filters.minPrice)
  const [prevMax, setPrevMax] = useState(filters.maxPrice)

  if (filters.minPrice !== prevMin || filters.maxPrice !== prevMax) {
    setPrevMin(filters.minPrice)
    setPrevMax(filters.maxPrice)
    setPendingMinPrice(filters.minPrice ?? '')
    setPendingMaxPrice(filters.maxPrice ?? '')
  }

  if (!activePanel) return null

  /** Comunica un cambio parcial conservando los filtros ajenos al panel. */
  function update(patch: Partial<CatalogFiltersState>) {
    onChange({ ...filters, ...patch })
  }

  /** Confirma el rango escrito antes de enviarlo a la página. */
  function handleApplyPrice() {
    update({
      minPrice: pendingMinPrice.trim(),
      maxPrice: pendingMaxPrice.trim(),
    })
  }

  /** Limpia valores pendientes y filtros aplicados, restaurando la relevancia. */
  function clearAll() {
    setPendingMinPrice('')
    setPendingMaxPrice('')
    onChange({
      categories: [],
      brands: [],
      specifications: {},
      minPrice: '',
      maxPrice: '',
      sort: 'relevance',
    })
  }

  return (
    <div
      key={activePanel}
      className={`${styles.panel} ${isUpdating ? styles.isUpdating : ''}`}
      aria-label="Filtros de productos"
    >
      {/* 1. Panel de MARCAS */}
      {activePanel === 'filters' && (
        <BrandFilter
          facets={facets}
          categorySelected={filters.categories.length > 0}
          values={filters.brands}
          onChange={(brands) => update({ brands })}
        />
      )}

      {/* 2. Panel de CATEGORÍAS */}
      {activePanel === 'categories' && (
        <CategoryTree
          facetCounts={facets.categories ?? {}}
          values={filters.categories}
          onChange={(categories) => update({ categories })}
        />
      )}

      {/* 3. Panel de PRECIO / ORDEN */}
      {activePanel === 'price' && (
        <fieldset className={`${styles.group} ${styles.priceGroup}`}>
          <legend>Precio y orden</legend>

          <div className={styles.priceLayout}>
            <div className={styles.controlField}>
              <label htmlFor="catalog-sort">Ordenar por</label>
              <select
                id="catalog-sort"
                value={filters.sort ?? 'relevance'}
                onChange={(e) => update({ sort: e.target.value as SortOption })}
              >
                <option value="relevance">Más relevantes</option>
                <option value="price_asc">Menor precio</option>
                <option value="price_desc">Mayor precio</option>
              </select>
            </div>

            <div className={styles.priceRange}>
              <span className={styles.controlLabel}>Rango de precio</span>
              <div className={styles.priceFields}>
                <label>
                  Desde
                  <input
                    type="number"
                    min="0"
                    placeholder="0"
                    value={pendingMinPrice}
                    onChange={(event) => setPendingMinPrice(event.target.value)}
                  />
                </label>
                <label>
                  Hasta
                  <input
                    type="number"
                    min="0"
                    placeholder="Máx"
                    value={pendingMaxPrice}
                    onChange={(event) => setPendingMaxPrice(event.target.value)}
                  />
                </label>
              </div>
            </div>

            <button
              className={styles.applyButton}
              type="button"
              onClick={handleApplyPrice}
            >
              Aplicar precio
            </button>
          </div>
        </fieldset>
      )}

      <button
        className={styles.clearButton}
        type="button"
        onClick={clearAll}
      >
        Limpiar filtros
      </button>
    </div>
  )
}

export default CatalogFilters