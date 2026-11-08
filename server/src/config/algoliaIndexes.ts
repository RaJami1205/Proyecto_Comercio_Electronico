/** Protege el catálogo comprobando, sin leer el entorno, que otro índice no apunte a products ni a sus réplicas. */
const PRODUCT_REPLICA_SUFFIXES = ['_price_asc', '_price_desc']

/** Compara nombres exactos porque Algolia distingue mayúsculas en los índices. */
export function collidesWithProductIndex(indexName: string, productIndexName: string): boolean {
  return [productIndexName, ...PRODUCT_REPLICA_SUFFIXES.map((suffix) => `${productIndexName}${suffix}`)].includes(indexName)
}
