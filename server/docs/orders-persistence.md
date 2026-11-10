# Orders Persistence & Idempotency · CN-58

CN-58 implementa `PostgreSQLOrderStore` como alternativa async reutilizando la infraestructura de CN-57. **El singleton comercial `orderStore` sigue siendo `new InMemoryOrderStore()` hasta completar y validar CN-59.** Tener `DATABASE_URL` no cambia esa selección. No se añade un selector por entorno ni se hace fallback cuando falla PostgreSQL.

`createOrderStore()` selecciona memoria por defecto; `createOrderStore('postgresql', database)` permite composición explícita exclusivamente en Server/tests controlados. Esa alternativa no se conecta automáticamente a Express. No activar PostgreSQL en Production con Payment Attempts todavía en memoria.

## Contratos V1 y async

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

PaymentService espera las lecturas/escrituras async. Comprueba ownership antes de Replay/errores de concurrencia y vuelve a leer la Order dentro del lock local para no pagar desde una lectura PENDING obsoleta. La actualización persistente escribe únicamente estados y updated_at, filtrando por id y propietario; no sustituye snapshots.

Payment Attempts y sus resultados/locks siguen en memoria. CN-58 no entrega exclusión distribuida, Payment Replay durable ni recuperación de CN-59. Una actualización incierta no se cachea como Payment exitoso. Esa limitación impide activar esta combinación en Production.

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
