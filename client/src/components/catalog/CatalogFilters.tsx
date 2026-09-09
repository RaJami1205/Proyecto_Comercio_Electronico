import { useState } from 'react'

import { useCategoryTree } from '../../hooks/useCategoryTree'
import type { CategoryTreeNode } from '../../services/productApi'
import type { CatalogFilters as CatalogFiltersState } from '../../services/productApi'
import styles from '../../styles/catalog/CatalogFilters.module.css'

interface CatalogFiltersProps {
  facets: Record<string, Record<string, number>>
  filters: CatalogFiltersState
  onChange: (filters: CatalogFiltersState) => void
  isUpdating?: boolean
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

function collectDescendantNames(node: CategoryTreeNode): string[] {
  return node.children.flatMap((child) => [child.name, ...collectDescendantNames(child)])
}

function chunk<T>(items: T[], size: number): T[][] {
  const groups: T[][] = []
  for (let index = 0; index < items.length; index += size) {
    groups.push(items.slice(index, index + size))
  }
  return groups
}

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

  function isVisible(name: string): boolean {
    return facetCounts[name] !== undefined || values.includes(name)
  }

  function toggleSelect(node: CategoryTreeNode, checked: boolean) {
    if (checked) {
      onChange([...values, node.name])
      return
    }
    const descendants = collectDescendantNames(node)
    onChange(values.filter((value) => value !== node.name && !descendants.includes(value)))
  }

  function renderNodes(nodes: CategoryTreeNode[], depth: number) {
    return nodes
      .filter((node) => isVisible(node.name))
      .map((node) => {
        const isChecked = values.includes(node.name)
        return (
          <div key={node.name}>
            <label className={styles.checkOption} style={{ paddingLeft: `${depth * 0.9}rem` }}>
              <input
                type="checkbox"
                checked={isChecked}
                onChange={(event) => toggleSelect(node, event.target.checked)}
              />
              <span>{node.name}</span>
              {facetCounts[node.name] !== undefined ? <small>{facetCounts[node.name]}</small> : null}
            </label>
            {isChecked && node.children.length > 0 ? renderNodes(node.children, depth + 1) : null}
          </div>
        )
      })
  }

  return (
    <fieldset className={styles.group}>
      <legend>Categorías</legend>
      {isLoading ? <p className={styles.leafNote}>Cargando categorías…</p> : renderNodes(tree, 0)}
    </fieldset>
  )
}

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

  if (visibleEntries.length === 0) return null

  const columns = chunk(visibleEntries, 10)

  return (
    <fieldset className={styles.group}>
      <legend>Marca</legend>
      <div className={styles.brandColumns}>
        {columns.map((column, columnIndex) => (
          <div className={styles.brandColumn} key={columnIndex}>
            {column.map(([value, count]) => (
              <label className={styles.checkOption} key={value}>
                <input
                  type="checkbox"
                  checked={values.includes(value)}
                  disabled={count === 0}
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
            ))}
          </div>
        ))}
      </div>
    </fieldset>
  )
}

function CatalogFilters({ facets, filters, onChange, isUpdating = false }: CatalogFiltersProps) {
  const [pendingMinPrice, setPendingMinPrice] = useState(filters.minPrice)
  const [pendingMaxPrice, setPendingMaxPrice] = useState(filters.maxPrice)

  function update(patch: Partial<CatalogFiltersState>) {
    onChange({ ...filters, ...patch })
  }

  function clearAll() {
    setPendingMinPrice('')
    setPendingMaxPrice('')
    onChange({ categories: [], brands: [], specifications: {}, minPrice: '', maxPrice: '' })
  }

  return (
    <div
      className={`${styles.panel} ${isUpdating ? styles.isUpdating : ''}`}
      aria-label="Filtros de productos"
    >
      <div className={styles.mainRow}>
        <CategoryTree
          facetCounts={facets.categories ?? {}}
          values={filters.categories}
          onChange={(categories) => update({ categories })}
        />

        <BrandFilter
          facets={facets}
          categorySelected={filters.categories.length > 0}
          values={filters.brands}
          onChange={(brands) => update({ brands })}
        />

        <fieldset className={styles.group}>
          <legend>Precio</legend>
          <div className={styles.priceFields}>
            <label>Desde<input type="number" min="0" value={pendingMinPrice} onChange={(event) => setPendingMinPrice(event.target.value)} /></label>
            <label>Hasta<input type="number" min="0" value={pendingMaxPrice} onChange={(event) => setPendingMaxPrice(event.target.value)} /></label>
          </div>
          <button className={styles.clearButton} type="button" onClick={() => update({ minPrice: pendingMinPrice, maxPrice: pendingMaxPrice })}>
            Aplicar precio
          </button>
        </fieldset>
      </div>

      <button className={styles.clearButton} type="button" onClick={clearAll}>
        Limpiar filtros
      </button>
    </div>
  )
}

export default CatalogFilters