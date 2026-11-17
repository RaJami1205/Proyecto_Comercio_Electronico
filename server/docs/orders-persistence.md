# Orders Persistence & Idempotency · CN-58

## Estado vigente y selección coordinada

`PostgreSQLOrderStore` (CN-58) y `PostgreSQLPaymentStore` (CN-59) están implementados sobre la [infraestructura PostgreSQL de CN-57](postgresql.md). Los servicios predeterminados de Express consumen una única pareja `commerceStores`; Orders y Payments se seleccionan conjuntamente, sin combinar almacenamiento PostgreSQL con In-Memory.

La configuración exclusiva de Server `COMMERCE_STORE_MODE` selecciona la pareja al iniciar el proceso:

| Valor | Orders | Payments |
|---|---|---|
| `memory` (default) | `InMemoryOrderStore` | `InMemoryPaymentStore` |
| `postgresql` | `PostgreSQLOrderStore` | `PostgreSQLPaymentStore`, compartiendo la misma `Database` |

El valor ausente o vacío conserva `memory`; un valor no reconocido impide el arranque. Tener `DATABASE_URL` por sí sola no activa PostgreSQL. Si se selecciona PostgreSQL, los errores de configuración o persistencia no provocan fallback silencioso a memoria.

La selección se implementa en [serverConfig](../src/config/env.ts), [commerceStores](../src/stores/commerceStores.ts) y [createCommerceStores](../src/stores/commerceStoreFactory.ts). La factoría permite también composición explícita en Server/tests controlados. PaymentService rechaza una pareja incompatible; el contrato transaccional se detalla en [Payment Persistence de CN-59](payments-persistence.md).

**La activación comercial PostgreSQL en Render Production sigue pendiente de QA, evidencia de integración y autorización explícita.** Disponer de infraestructura PostgreSQL o de migrations aplicadas no equivale a seleccionar esos repositorios para las rutas comerciales ni autoriza una activación. La composición predeterminada continúa In-Memory.

> Contexto histórico de CN-58: esa entrega conservó el singleton `orderStore = new InMemoryOrderStore()` y no conectó la alternativa PostgreSQL a Express. La composición vigente descrita arriba incorpora también Payment Persistence y la selección coordinada por configuración.

## Contratos V1 y async

### Transición HTTP V1/V2 · CN-61, corrección F1.1

`ORDER_CREATION_MODE` es configuración exclusiva de Server, independiente de `COMMERCE_STORE_MODE` y de `DATABASE_URL`. Solo admite `v1-compatible` (default) o `v2-only`; un valor no reconocido impide el arranque. El Client no selecciona este modo mediante el body ni headers.

| Modo | POST /api/orders (V1, solo B2C) | POST /api/v2/orders |
|---|---|---|
| `v1-compatible` | Creación y Replay históricos para el Checkout vigente | Creación/Replay B2C y B2B con Pricing/MOQ/Branch autoritativos |
| `v2-only` | Solo Replay compatible existente; una key nueva devuelve 410 ORDER_CONTRACT_DEPRECATED | Conserva las validaciones V2 |

B2B y ADMIN no pueden crear ni reproducir compras mediante V1. ADMIN tampoco puede comprar mediante V2. GET y Payment conservan las guardas de identidad/ownership existentes para Orders B2C/B2B.

En `v2-only` se reutiliza Create-or-Replay: el store verifica owner y payload antes de invocar el builder. Un Replay válido no consulta catálogo ni recalcula precios, inventario o Terms. Una key ajena conserva 404 y una solicitud incompatible del mismo owner conserva 409. El builder de una key nueva devuelve 410 antes de consultar productos; PostgreSQL revierte su claim transaccional sin guardar una Order ni una Creation Request. No se implementa otra ruta de recuperación ni se reintentan operaciones comerciales automáticamente.

Mantener `v1-compatible` mientras el Client utilice Checkout V1. Esa compatibilidad conserva las reglas históricas B2C, sin prometer validación de sucursal V2. El corte integral requiere integrar/validar CN-62 y configurar explícitamente `v2-only` al reiniciar Server, para impedir nuevas compras legacy que omitan las reglas V2. Cambiar el modo no migra Orders ni activa PostgreSQL; no se modifica ninguna configuración productiva con este fix.

- `OrderStore` expone Create-or-Replay, búsquedas y actualización de estados mediante Promises. La creación persistente no ofrece un INSERT de Order separado de Idempotency. `InMemoryOrderStore.create` permanece como utilidad async de fixtures/compatibilidad legacy.
- `OrderService.create` recibe el `ResolvedUser` ya validado por CN-54; conserva B2C-only. Copia id/displayName/role desde ese contexto, nunca del body. No consulta nuevamente Algolia Users.
- El DTO HTTP de Order no cambia ni expone ownership interno. GET espera el resultado async. Las búsquedas de propietario, Payment y Replay ajeno conservan 404.
- La key V1 sigue siendo global. La canonicalización conserva Buyer/Delivery normalizados, Terms y cantidades agregadas/ordenadas. No cambia el tratamiento histórico de teléfonos, email, información adicional vacía ni líneas repetidas.
- Se captura la vigencia de Terms al recibir la solicitud, como en V1; solo se exige al ganar una creación nueva. Replay admite versiones reconocidas históricas y no ejecuta el builder.
- UUID, Order Number y snapshots financieros siguen generándose con las reglas existentes. Las Orders legacy sin owner no se asignan a una identidad seleccionada ni se migran automáticamente desde memoria.

## Create-or-Replay

En un único PoolClient, mediante `Database.transaction`:

1. Configurar READ COMMITTED y límites locales de SQL/locks/idle.
2. Reclamar la key con `INSERT ... ON CONFLICT (idempotency_key) DO NOTHING RETURNING order_id`, incluyendo propietario, payload canónico, versión y UUID reservado.
3. Solo el ganador ejecuta el builder comercial. Inserta la Order usando ese UUID y confirma ambos registros conjuntamente. La FK diferible de CN-57 permite reclamar la key antes de insertar su Order.
4. El perdedor consulta la key en otra sentencia, necesaria para observar al ganador bajo READ COMMITTED. Comprueba propietario antes del payload/mapping: 404 ajeno, 409 incompatible, Replay de la Order actual cuando coincide.
5. Cualquier fallo antes del COMMIT revierte ambas escrituras. Las excepciones `OrderError` del callback se retienen en la frontera del repositorio y se restauran después del rollback; los detalles del driver permanecen sanitizados.

No se añaden permisos UPDATE sobre Creation Requests ni modificaciones al schema. Las claves del proceso y Promise Sharing ayudan localmente; la garantía entre procesos depende de las constraints/transacción de PostgreSQL. No existe un registro pending confirmado que requiera borrarse para liberar la key.

## Tiempos e incertidumbre

Los valores revisados de CN-57 son adquisición de Pool 5000 ms y statement timeout 15000 ms, configurables mediante sus variables existentes. El Client V1 espera 20000 ms. CN-58 usa estos límites propios, configurables solo mediante opciones de construcción internas para tests/composición:

| Límite | Default |
|---|---:|
| Trabajo dentro del callback transaccional, incluido el builder completo | 8000 ms |
| Consulta individual y BEGIN/COMMIT/ROLLBACK | 2000 ms |
| Espera de locks SQL | 1000 ms |
| Idle de la transacción mientras se espera al catálogo | 8000 ms |

El presupuesto de trabajo se comprueba antes de cada consulta y de confirmar el resultado del callback. El builder recibe AbortSignal y tiene timeout global, no un timeout nuevo por producto. OrderService comprueba cancelación antes/después de cada lookup. La llamada SDK ya iniciada puede terminar en segundo plano bajo sus mecanismos existentes; sus resultados tardíos no pueden insertar ni iniciar más lookups. No se modifica ProductService, Algolia ni PricingService.

Los límites de adquisición, cleanup y reconciliación son adicionales al presupuesto del callback. No constituyen una promesa de responder antes del timeout del Client bajo fallos de red. En ese caso el Client conserva su key y solicitud. No hay reintentos automáticos del builder ni de la operación comercial.

Un COMMIT incierto conserva `outcome=unknown`. Tras descartar/liberar el client original, se adquiere otro lease y se hace BEGIN READ ONLY, SELECT por la misma key y ROLLBACK. Si aparece una Order compatible del mismo propietario, se devuelve su snapshot persistido. Una lectura vacía, datos inválidos o una conexión inaccesible mantienen la incertidumbre. No se crea otra Order ni otra key automáticamente.

La indisponibilidad se presenta como HTTP 503 con el código V1 `UNEXPECTED_ERROR`. Para incertidumbre se añade `error.outcome: 'unknown'` y un mensaje fijo. El Client actual ignora campos adicionales y conserva el intento ante 5xx; no se cambia su código. No se imprimen SQL, payload canónico, PII, credenciales, certificados ni errores completos de pg.

## Mapping y Payment

El mapper valida filas desde `unknown`: NUMERIC como strings decimales, JSONB con campos del DTO V1, timestamps válidos normalizados a ISO UTC y pares coherentes de estados. Escribe la representación completa de cada number, sin `toFixed`, redondeo ni recálculo de importes históricos. Preserva acceptedAt/versión y precios unitarios con más de dos decimales. Los contratos de fila futuros desconocidos fallan de forma controlada.

PaymentService espera las operaciones async y utiliza la abstracción de [Payment Persistence de CN-59](payments-persistence.md). El mecanismo In-Memory mantiene locks locales; la alternativa PostgreSQL revalida la Order con FOR UPDATE NOWAIT y registra el Attempt junto con los estados en una transacción. Ambas comprueban ownership antes de Replay y conservan el histórico aunque cambie el estado actual.

La actualización persistente escribe únicamente estados y updated_at, filtrando por id y propietario; no sustituye snapshots. Las operaciones internas `readForPayment` y `updateWithClient` reutilizan el PoolClient del caller sin abrir una segunda transacción. `createCommerceStores` permite seleccionar Orders y Payments juntos; PaymentService rechaza una mezcla incompatible. La composición predeterminada sigue In-Memory y la activación productiva exige validación integral y autorización independiente.

## Validación y estado

Se prueban mediante mocks la secuencia SQL, rollback, claims concurrentes simulados, propietarios, conflictos, mapping, cancelación y reconciliación. Las pruebas de instancia nueva reutilizan un modelo en memoria; **no demuestran un reinicio real de PostgreSQL ni durabilidad/concurrencia reales**.

Desde `server/`, build y suites locales, evitando `.env` privado e Integration Tests:

```powershell
npm run build
$env:DOTENV_CONFIG_PATH = Join-Path (Get-Location) '.env.database.example'
$env:CLIENT_ORIGIN = 'http://localhost:5173'
$cn58Tests = Get-ChildItem -LiteralPath tests -Filter '*.test.mjs' | Where-Object { $_.Name -notlike '*.integration.test.mjs' } | ForEach-Object FullName
node --test --test-skip-pattern='^el seed usa dry-run por defecto y sus guardas abortan sin escribir$' @cn58Tests
```

El test de guardas del seed se omite porque invoca un script que carga `server/.env` con ruta explícita. No fue modificado por CN-58. Los tests HTTP solo usan loopback y fronteras externas simuladas. `db:smoke` no es parte de esta ejecución.

No usar la única base Production para estas pruebas. No se ejecutaron migrations, conexiones remotas ni Integration Tests. Se necesita un entorno PostgreSQL independiente y autorizado para comprobar COMMIT real, concurrencia entre procesos, reinicio, FKs y permisos. No basta otro schema dentro de Production ni se debe eludir el guard mediante un túnel.

Jira CN-58 fue consultado. El alcance y la restricción de activación hasta CN-59 están disponibles. Los Acceptance Criteria formales siguen NOT VERIFIED; la descripción termina en «No modificar PricingService ni». No se inventa la continuación ni se modifican los servicios potencialmente excluidos.
