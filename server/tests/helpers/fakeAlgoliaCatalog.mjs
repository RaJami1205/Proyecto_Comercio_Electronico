/**
 * CN-69 QA: catálogo ficticio que reproduce en memoria las consultas que el Server hace a Algolia.
 * Nunca contacta Algolia ni modifica índices productivos. Los datos son sintéticos.
 */
export const QA_ALGOLIA_ENV = Object.freeze({
  ALGOLIA_APP_ID: 'QA_FAKE_APP', ALGOLIA_API_KEY: 'qa-fake-key',
  ALGOLIA_INDEX_NAME: 'qa_products', ALGOLIA_USERS_INDEX_NAME: 'qa_users',
})

const product = (objectID, title, price, categories, brand, b2b, stock, extra = {}) => ({
  objectID, title, price, image_url: '', categories, brand, description: 'Producto ficticio de QA ' + title + '.',
  in_stock: Object.values(stock).some(quantity => quantity > 0),
  stock_quantity: Object.values(stock).reduce((sum, quantity) => sum + quantity, 0),
  b2b, stock_by_branch: stock, facets: {}, ...extra,
})

/** Productos con Retail, Wholesale, MOQ y existencias por sucursal pensados para cada escenario E2E. */
export const QA_PRODUCTS = Object.freeze([
  product('qa-ssd-1tb', 'SSD NVMe 1 TB', 45000, ['Almacenamiento', 'SSD'], 'Kingston',
    { available: true, wholesale_price: 39000, min_order_quantity: 3 }, { san_jose: 20, alajuela: 2, cartago: 0, heredia: 8 }, { facets: { capacity: '1 TB' } }),
  product('qa-monitor-27', 'Monitor 27 pulgadas', 165000, ['Monitores'], 'Dell',
    { available: true, wholesale_price: 148000, min_order_quantity: 2 }, { san_jose: 5, alajuela: 10, cartago: 3, heredia: 0 }),
  product('qa-mouse', 'Mouse inalámbrico', 12500, ['Periféricos', 'Mouse'], 'Logitech',
    { available: false }, { san_jose: 50, alajuela: 40, cartago: 30, heredia: 20 }),
  product('qa-keyboard', 'Teclado mecánico', 38000, ['Periféricos', 'Teclados'], 'Logitech',
    { available: true, wholesale_price: 33000, min_order_quantity: 5 }, { san_jose: 4, alajuela: 12, cartago: 6, heredia: 6 }),
  product('qa-ram-32', 'Memoria RAM 32 GB', 72000, ['Componentes', 'Memoria'], 'Corsair',
    { available: true, wholesale_price: 64000, min_order_quantity: 4 }, { san_jose: 16, alajuela: 16, cartago: 16, heredia: 16 }),
  product('qa-laptop-14', 'Laptop 14 pulgadas', 485000, ['Computadoras', 'Laptops'], 'Lenovo',
    { available: true, wholesale_price: 450000, min_order_quantity: 1 }, { san_jose: 3, alajuela: 1, cartago: 0, heredia: 2 }),
  product('qa-router', 'Router WiFi 6', 56000, ['Redes'], 'TP-Link',
    { available: true, wholesale_price: 49000, min_order_quantity: 3 }, { san_jose: 0, alajuela: 0, cartago: 0, heredia: 0 }),
  product('qa-headset', 'Audífonos con micrófono', 29000, ['Periféricos', 'Audio'], 'HyperX',
    { available: true, wholesale_price: 25000, min_order_quantity: 10 }, { san_jose: 30, alajuela: 9, cartago: 15, heredia: 12 }),
])

/** Identidades simuladas del directorio users, con el formato que valida UserService. */
export const QA_USERS = Object.freeze([
  { objectID: 'qa-b2c', displayName: 'Cliente QA', role: 'B2C', enabled: true },
  { objectID: 'qa-b2c-2', displayName: 'Otra persona QA', role: 'B2C', enabled: true },
  { objectID: 'qa-b2b', displayName: 'Compras Empresa QA', role: 'B2B', enabled: true, company: { id: 'qa-company', name: 'Distribuidora QA' } },
  { objectID: 'qa-admin', displayName: 'Administración QA', role: 'ADMIN', enabled: true },
  { objectID: 'qa-disabled', displayName: 'Cuenta deshabilitada QA', role: 'B2C', enabled: false },
])

const words = query => String(query ?? '').toLowerCase().split(/\s+/).filter(Boolean)
const matchesQuery = (record, query) => words(query).every(word => record.title.toLowerCase().includes(word)
  || (record.brand ?? '').toLowerCase().includes(word) || record.categories.some(category => category.toLowerCase().includes(word)))
const matchesFacet = (record, filter) => {
  const [attribute, ...rest] = filter.split(':')
  const value = rest.join(':')
  return attribute === 'categories' ? record.categories.includes(value) : attribute === 'brand' ? record.brand === value : false
}
const matchesNumeric = (record, filter) => {
  const match = /^price(>=|<=)(\d+(?:\.\d+)?)$/.exec(filter)
  if (!match) throw new Error('Filtro numérico no soportado por el catálogo QA: ' + filter)
  return match[1] === '>=' ? record.price >= Number(match[2]) : record.price <= Number(match[2])
}
function highlight(title, query, pre, post) {
  let value = title
  for (const word of words(query)) value = value.replace(new RegExp('(' + word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'i'), pre + '$1' + post)
  return { value, matchLevel: value === title ? 'none' : 'full', matchedWords: [] }
}

/** Crea un cliente compatible con searchSingleIndex y getObject; registra las consultas para la evidencia. */
export function createFakeAlgoliaCatalog(products = QA_PRODUCTS, { productsIndex = QA_ALGOLIA_ENV.ALGOLIA_INDEX_NAME } = {}) {
  const calls = []
  async function searchSingleIndex({ indexName, searchParams = {} }) {
    calls.push({ type: 'search', indexName, searchParams })
    const base = indexName.replace(/_price_(asc|desc)$/, '')
    if (base !== productsIndex) throw Object.assign(new Error('Índice desconocido en QA: ' + indexName), { status: 404 })
    let hits = products.filter(record => matchesQuery(record, searchParams.query))
      .filter(record => (searchParams.facetFilters ?? []).every(group => group.some(filter => matchesFacet(record, filter))))
      .filter(record => (searchParams.numericFilters ?? []).every(filter => matchesNumeric(record, filter)))
    if (indexName.endsWith('_price_asc')) hits = [...hits].sort((a, b) => a.price - b.price)
    if (indexName.endsWith('_price_desc')) hits = [...hits].sort((a, b) => b.price - a.price)
    const facets = {}
    for (const attribute of searchParams.facets ?? []) {
      facets[attribute] = {}
      for (const record of hits) {
        for (const value of attribute === 'categories' ? record.categories : [record[attribute]]) {
          if (value !== undefined) facets[attribute][value] = (facets[attribute][value] ?? 0) + 1
        }
      }
    }
    const hitsPerPage = searchParams.hitsPerPage ?? 20
    const page = searchParams.page ?? 0
    const nbHits = hits.length
    const pageHits = hits.slice(page * hitsPerPage, page * hitsPerPage + hitsPerPage).map(record => structuredClone(
      searchParams.highlightPreTag ? { ...record, _highlightResult: { title: highlight(record.title, searchParams.query, searchParams.highlightPreTag, searchParams.highlightPostTag) } } : record))
    return { hits: pageHits, nbHits, nbPages: Math.ceil(nbHits / hitsPerPage), page, hitsPerPage, facets, exhaustive: { nbHits: true }, exhaustiveNbHits: true }
  }
  async function getObject({ indexName, objectID }) {
    calls.push({ type: 'getObject', indexName, objectID })
    const record = indexName === productsIndex ? products.find(item => item.objectID === objectID) : undefined
    if (!record) throw Object.assign(new Error('ObjectID does not exist'), { status: 404 })
    return structuredClone(record)
  }
  return { calls, searchSingleIndex, getObject }
}
