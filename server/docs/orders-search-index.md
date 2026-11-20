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

- `objectID` es el `id` de PostgreSQL. Una única `partialUpdateObject` envía los atributos proyectados y `IncrementSet` sobre `indexVersion`: solo una revisión superior puede actualizar el registro completo. Una inferior o igual no modifica ningún atributo. `createIfNotExists: true` permite crear un registro ausente con una revisión positiva, sin duplicados.
- `company` aparece solo en Orders B2B. `branchId` es `null` en Orders V1, que no registraban sucursal.
- `createdAtTimestamp` (segundos Unix) permite filtros por rango de fechas.
- **No se indexan** Buyer, Delivery, productos, Terms Acceptance, intentos de pago ni datos de tarjeta.

## Revisiones persistentes

La migración `20261118000100_order_search_index.sql` agrega a `commerce.orders`:

| Columna | Significado |
|---|---|
| `index_version` | Revisión autoritativa. Empieza en 1 y aumenta en el mismo `UPDATE` que cambia `order_status`/`payment_status`. Un Replay de pago no la incrementa. |
| `indexed_version` | Última revisión confirmada en Algolia. `indexed_version < index_version` significa pendiente. |
| `index_lease_token`, `index_lease_expires_at` | Lease breve por Order que coordina los claims y condiciona su confirmación. Puede vencer aunque el worker continúe; la operación condicional en Algolia impide que ese worker sobrescriba una revisión superior. |
| `index_synced_at`, `index_attempted_at`, `index_failure_count`, `index_last_error` | Resultado de la última sincronización. El error solo guarda una categoría: `configuration`, `unavailable`, `rejected` o `invalid-record`. |

Las Orders existentes quedan pendientes (`1 > 0`) al aplicar la migración, listas para la indexación inicial.

**Orden de despliegue obligatorio:** aplicar la migración en PostgreSQL **antes** de desplegar este código. El `UPDATE` de estados del pago incrementa `index_version`; sin la columna, los pagos en modo PostgreSQL fallarían.

## Flujo de sincronización

[OrderIndexSyncService](../src/services/orderIndexSyncService.ts):

1. `OrderService` y `PaymentService` llaman al notifier **después** del commit. La llamada no espera a Algolia ni altera la respuesta.
2. El servicio toma el lease solo si hay una revisión pendiente, lee la fila autoritativa y la transforma con el mapper.
3. Envía la actualización condicional, espera de forma acotada la tarea y consulta el registro sin caché. Compara todos los atributos proyectados con la misma regla usada por `verifyRemote`; el acuse de escritura o la publicación de la tarea no bastan por sí solos.
4. Solo tras comprobar el contenido esperado intenta marcar `indexed_version`, con el mismo token de lease. Una revisión remota diferente o atributos incompatibles dejan el intento sin confirmar. Un reintento de la misma revisión puede confirmarse si la lectura demuestra que ya está publicada íntegramente.
5. Si mientras tanto se registró otra revisión (por ejemplo, un pago), repite con la versión nueva.

Ningún lock de PostgreSQL se mantiene durante la llamada a Algolia, por lo que la sincronización no bloquea pagos.

La garantía condicional y la necesidad de leer después de una operación descartada se describen en [Handling concurrency with versioning](https://www.algolia.com/doc/guides/sending-and-managing-data/send-and-update-your-data/in-depth/handling-concurrency-with-versioning). Si la respuesta de escritura o la lectura de comprobación falla, no se confirma la revisión. Si solo falla la espera de la tarea, una lectura íntegramente coincidente sí aporta evidencia de publicación. No se utiliza una lectura seguida de un reemplazo incondicional.

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

Todos los comandos se ejecutan desde `server/`. Por defecto leen `server/.env`, resuelto respecto al script. Si se define `DOTENV_CONFIG_PATH`, utilizan exclusivamente esa ruta, también en la carga posterior de `dotenv/config`; una ruta relativa se resuelve desde el directorio de trabajo. El modo de escritura requiere `--write` y la confirmación exacta del índice. **No ejecutar `--write` sobre producción sin autorización explícita.**

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

Obtiene los atributos del Index Record desde Algolia sin caché para las Orders marcadas como sincronizadas. Para cada registro presente con revisión válida, relee el snapshot vigente de PostgreSQL mediante `SELECT`, sin lease ni escrituras. El mapper existente construye la proyección histórica autoritativa, sin consultar Products ni Cart.

Con revisiones iguales, compara todos los campos obligatorios, sus tipos y sus valores, incluidos total, moneda, estados y `branchId` (que debe ser `null` en V1, no ausente). Company es opcional en B2C (ausencia no equivale a `null`) y requiere id/name completos en B2B. Se ignoran atributos y metadatos ajenos al DTO, también dentro de Company. `save` reutiliza esta misma comparación.

| Estado remoto | Tratamiento |
|---|---|
| Ausente (`null` en la respuesta de Algolia) | Drift; con `--write`, marca pendiente y sincroniza con el protocolo condicional. |
| Revisión positiva inferior | Drift; con `--write`, vuelve a sincronizar sin reemplazos incondicionales. |
| Revisión igual y proyección idéntica | Sin drift; no confirma ni modifica el marcador PostgreSQL. |
| Revisión igual y contenido diferente, incompleto o con tipos incorrectos | `drift` y `failed`, sin reparación automática ni escrituras; requiere intervención controlada. |
| Revisión superior | Relee la versión vigente en PostgreSQL. Si ya coincide, reconoce el avance concurrente; si PostgreSQL avanzó aún más, trata la copia remota como anterior. |
| Revisión superior incluso después de releer PostgreSQL | Inconsistencia no resuelta: incrementa `drift` y `failed`, registra un mensaje sanitizado y no modifica ningún registro. |
| Revisión inválida (ausente dentro del objeto, no numérica, no entera o menor que 1) | Inconsistencia no resuelta: incrementa `drift` y `failed`, sin reparación automática. |
| Error o respuesta incompleta de Algolia | Error sanitizado; no se interpreta como registro ausente ni autoriza escrituras de reparación. |

La página inicial solo determina el cursor. La relectura del snapshot completo conserva la comprobación de concurrencia de F2-02: si PostgreSQL avanzó, se compara contra esa revisión vigente, evitando atribuir una diferencia legítima al contenido de la revisión anterior. Son lecturas acotadas, no una instantánea atómica entre ambos servicios.

Las inconsistencias se reportan también en Dry-Run y permanecen visibles en verificaciones posteriores. No se cuentan como `repaired`. `indexed_version` conserva su valor histórico; una inconsistencia detectada impide considerar satisfactoria esta verificación, aunque el barrido de pendientes por sí solo informe cero.

**Límite contractual de reparación:** `IncrementSet` no permite sustituir una revisión remota 999 por la revisión autoritativa 2, ni corregir atributos incompatibles reenviando la misma revisión. No se adopta ni incrementa artificialmente la revisión PostgreSQL para superar esa condición. Tampoco se utiliza SaveObject, downgrade ciego o Delete + Recreate. La reparación completa exige aprobar un procedimiento que defina cómo excluir todos los escritores y operaciones en vuelo y cómo restablecer la proyección/versionado. Hasta entonces, se conserva la inconsistencia y se informa como fallo no resuelto. La detección y señalización de F2-03 no equivalen a haber reparado automáticamente la proyección.

El CLI termina con código 1 cuando `verifyRemote` devuelve `failed > 0`, también ante reparaciones parciales o inconsistencias detectadas en Dry-Run. Sin fallos conserva el código 0; un Dry-Run con drift reparable y sin fallos también termina con 0. Las excepciones mantienen el código 1 y los mensajes sanitizados existentes. Se espera el cierre de PostgreSQL en `finally`, sin utilizar `process.exit()`.

### Verificar

- `npm run orders:index` debe informar `Pendientes: 0` después de la indexación inicial.
- `--verify-remote` debe informar cero drift y cero fallidas; revisar también los mensajes de inconsistencias. El código de salida indica si hubo fallos, no si un Dry-Run encontró drift reparable.
- En el dashboard de Algolia, el índice orders debe tener un registro por Order, sin campos de Buyer ni Delivery.

## Consultas administrativas (CN-66)

[orderIndexQuery](../src/domain/orderIndexQuery.ts) define `buildOrderIndexFilters`, que valida cada valor antes de construir el filtro: por usuario, por tipo B2C/B2B, por sucursal, por estado y por rango de fechas. La búsqueda por número usa `orderNumber` como atributo buscable.

`GET /api/v2/admin/orders` (ver [README del Server](../README.md#admin-orders-cn-66)) usa el índice solo cuando recibe texto (`q`), siempre desde Server y después de RBAC. Cada coincidencia se relee de PostgreSQL. El listado sin texto consulta directamente PostgreSQL e incluye las Orders pendientes de indexar, y el detalle completo proviene de `GET /api/v2/orders/:orderId`.

## Pruebas

- `tests/orderIndex.test.mjs`: mapper, filtros, configuración, adaptador del SDK, Retry, Reconciliation, verificación remota, notifier y guardas del script, con dobles en memoria.
- `tests/orderIndex.integration.test.mjs`: PostgreSQL real efímero (CI), con revisiones por Payment, leases, revisiones obsoletas, Recovery y permisos del runtime. Algolia se sustituye por un escritor en memoria.

Ninguna prueba contacta Algolia ni bases de producción.

Los subprocesses del CLI usan un directorio temporal, configuración ficticia mediante `DOTENV_CONFIG_PATH` y permisos de lectura de Node.js 24 acotados a módulos públicos y fixtures. Un preload exclusivo de estas pruebas audita las lecturas de dotenv y bloquea sockets/TLS/fetch. El contrato de la ruta manual se prueba redirigiendo su lectura al fixture, sin abrir ni inspeccionar el archivo privado. Los casos del CLI no necesitan excluirse por F3-02.
