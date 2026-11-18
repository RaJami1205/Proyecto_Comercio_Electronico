# Orders Search Index · CN-65

## Fuente de verdad y consistencia

| Responsabilidad | Fuente |
|---|---|
| Orders, snapshots históricos, Payment States y ownership | **PostgreSQL** (`commerce.orders`, `commerce.payment_attempts`) |
| Búsqueda y filtros administrativos de Orders | **Algolia**, índice `orders` (proyección resumida) |

Algolia es una copia consultable con **consistencia eventual**. Un retraso o un fallo de indexación nunca invalida una Order ni un pago confirmados en PostgreSQL. Las consultas transaccionales, de ownership, Order History y Payment siguen leyendo PostgreSQL con RBAC. El índice no se expone al Client: futuras consultas administrativas deben pasar por Server.

La proyección solo se activa con `COMMERCE_STORE_MODE=postgresql`. Con el almacenamiento In-Memory no existen revisiones persistentes y no se sincroniza nada.

## Registro indexado

`OrderIndexRecord` ([types/orderIndex.ts](../src/types/orderIndex.ts)) lo construye [orderIndexMapper](../src/domain/orderIndexMapper.ts) a partir de la fila persistida, sin consultar el catálogo ni recalcular importes.

```json
{
  "objectID": "<id de commerce.orders>",
  "orderNumber": "CN-2026-…",
  "userId": "user-b2b-01",
  "customerRole": "B2B",
  "branchId": "san_jose",
  "createdAt": "2026-10-26T18:00:00.000Z",
  "createdAtTimestamp": 1793037600,
  "orderStatus": "CONFIRMED",
  "paymentStatus": "APPROVED",
  "total": 369510,
  "currency": "CRC",
  "indexVersion": 2,
  "contractVersion": 2,
  "company": { "id": "company-demo-01", "name": "Distribuidora Demo" }
}
```

- `objectID` es el `id` de PostgreSQL; las escrituras usan `addOrUpdateObject`, que reemplaza por `objectID`, por lo que los reintentos nunca duplican registros.
- `company` aparece solo en Orders B2B. `branchId` es `null` en Orders V1, que no registraban sucursal.
- `createdAtTimestamp` (segundos Unix) permite filtros por rango de fechas.
- **No se indexan** Buyer, Delivery, productos, Terms Acceptance, intentos de pago ni datos de tarjeta.

## Revisiones persistentes

La migración `20261118000100_order_search_index.sql` agrega a `commerce.orders`:

| Columna | Significado |
|---|---|
| `index_version` | Revisión autoritativa. Empieza en 1 y aumenta en el mismo `UPDATE` que cambia `order_status`/`payment_status`. Un Replay de pago no la incrementa. |
| `indexed_version` | Última revisión confirmada en Algolia. `indexed_version < index_version` significa pendiente. |
| `index_lease_token`, `index_lease_expires_at` | Lease breve por Order que impide dos escrituras simultáneas. Expira si el proceso se detiene. |
| `index_synced_at`, `index_attempted_at`, `index_failure_count`, `index_last_error` | Resultado de la última sincronización. El error solo guarda una categoría: `configuration`, `unavailable`, `rejected` o `invalid-record`. |

Las Orders existentes quedan pendientes (`1 > 0`) al aplicar la migración, listas para la indexación inicial.

**Orden de despliegue obligatorio:** aplicar la migración en PostgreSQL **antes** de desplegar este código. El `UPDATE` de estados del pago incrementa `index_version`; sin la columna, los pagos en modo PostgreSQL fallarían.

## Flujo de sincronización

[OrderIndexSyncService](../src/services/orderIndexSyncService.ts):

1. `OrderService` y `PaymentService` llaman al notifier **después** del commit. La llamada no espera a Algolia ni altera la respuesta.
2. El servicio toma el lease solo si hay una revisión pendiente, lee la fila autoritativa y la transforma con el mapper.
3. Escribe el registro y espera la tarea de Algolia.
4. Marca `indexed_version` con la revisión escrita, solo si conserva el lease y la revisión no es anterior a la ya sincronizada.
5. Si mientras tanto se registró otra revisión (por ejemplo, un pago), repite con la versión nueva.

Ningún lock de PostgreSQL se mantiene durante la llamada a Algolia, por lo que la sincronización no bloquea pagos.

**Fallos.** Los fallos temporales (red, timeout, 429, 5xx) se reintentan dos veces en el proceso. Los rechazos (403, 404, 400) y la configuración inválida no se reintentan. En todos los casos la revisión sigue pendiente en PostgreSQL y se registra solo la categoría del error, sin mensajes del SDK, credenciales ni datos personales. Una respuesta incierta de Algolia se trata como fallo: el reintento reescribe el mismo `objectID`.

## Configuración

| Variable | Dónde | Propósito |
|---|---|---|
| `ALGOLIA_ORDERS_INDEX_NAME` | Server | Nombre del índice. No puede coincidir con `ALGOLIA_INDEX_NAME`, sus réplicas ni `ALGOLIA_USERS_INDEX_NAME`. |
| `ALGOLIA_ORDERS_API_KEY` | Server | Clave restringida al índice orders con ACL `search`, `addObject`. No es la Admin API Key. |
| `ALGOLIA_ORDERS_RECONCILE_ON_START` | Server, opcional | `true` ejecuta una pasada de Reconciliation (máximo 100 Orders) al iniciar, sin bloquear el arranque. |
| `ALGOLIA_ORDERS_SETTINGS_API_KEY` | Solo terminal de mantenimiento | ACL `editSettings` sobre el índice orders. No configurarla en Render. |

Sin `ALGOLIA_ORDERS_INDEX_NAME` o `ALGOLIA_ORDERS_API_KEY`, el Server funciona igual y las revisiones quedan pendientes en PostgreSQL. Las variables nunca se exponen al Client (`VITE_*`).

## Procedimientos de mantenimiento

Todos los comandos se ejecutan desde `server/`. Leen `server/.env`; el modo de escritura requiere `--write` y la confirmación exacta del índice. **No ejecutar `--write` sobre producción sin autorización explícita.**

### 1. Aplicar la migración

Aplicar `supabase/migrations/20261118000100_order_search_index.sql` con el procedimiento de [postgresql.md](postgresql.md), antes de desplegar el código.

### 2. Configurar el índice

```sh
npm run orders:index -- --configure-settings
npm run orders:index -- --configure-settings --write --confirm-index=NOMBRE_DEL_INDICE_ORDERS
```

El primero muestra los settings sin contactar Algolia. El segundo aplica `searchableAttributes` (`orderNumber`, `company.name`), `attributesForFaceting` (`userId`, `customerRole`, `branchId`, `orderStatus`, `paymentStatus`, `company.id`, `contractVersion`) y `customRanking` por fecha descendente, con `ALGOLIA_ORDERS_SETTINGS_API_KEY`. No modifica los índices `products` ni `users`.

### 3. Indexación inicial y Reconciliation

```sh
npm run orders:index
npm run orders:index -- --write --confirm-index=NOMBRE_DEL_INDICE_ORDERS
```

El dry-run lee las Orders pendientes de PostgreSQL y valida sus registros. No escribe en Algolia ni en PostgreSQL e informa pendientes, válidas e inválidas. Con `--write` sincroniza cada Order pendiente con el mismo protocolo de lease. Ejecutarlo varias veces es seguro: las Orders sincronizadas dejan de estar pendientes. `--limit=<n>` acota la pasada (500 por defecto). El comando termina con código 1 si quedan Orders fallidas o inválidas.

### 4. Verificación contra Algolia

```sh
npm run orders:index -- --verify-remote
npm run orders:index -- --verify-remote --write --confirm-index=NOMBRE_DEL_INDICE_ORDERS
```

Compara `indexVersion` en Algolia con `index_version` en PostgreSQL para las Orders marcadas como sincronizadas. Detecta registros ausentes (por ejemplo, un índice vaciado) u obsoletos. Con `--write` los vuelve a marcar como pendientes y los sincroniza.

### Verificar

- `npm run orders:index` debe informar `Pendientes: 0` después de la indexación inicial.
- `--verify-remote` debe informar `ausentes u obsoletas: 0`.
- En el dashboard de Algolia, el índice orders debe tener un registro por Order, sin campos de Buyer ni Delivery.

## Consultas administrativas futuras

[orderIndexQuery](../src/domain/orderIndexQuery.ts) define `buildOrderIndexFilters`, que valida cada valor antes de construir el filtro: todas las Orders, por usuario, por tipo B2C/B2B, por sucursal, por estado y por rango de fechas. La búsqueda por número usa `orderNumber` como atributo buscable. La Story del Admin Panel debe ejecutar estas consultas desde Server, después de RBAC, y recuperar el detalle completo desde PostgreSQL.

## Pruebas

- `tests/orderIndex.test.mjs`: mapper, filtros, configuración, adaptador del SDK, Retry, Reconciliation, verificación remota, notifier y guardas del script, con dobles en memoria.
- `tests/orderIndex.integration.test.mjs`: PostgreSQL real efímero (CI), con revisiones por Payment, leases, revisiones obsoletas, Recovery y permisos del runtime. Algolia se sustituye por un escritor en memoria.

Ninguna prueba contacta Algolia ni bases de producción.
