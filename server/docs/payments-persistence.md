# Payment Persistence & Recovery · CN-59

La implementación añade persistencia PostgreSQL opcional para Payment Sandbox V1. **Express continúa usando InMemoryOrderStore + InMemoryPaymentStore**, independientemente de DATABASE_URL. No se habilitó PostgreSQL en Production y no existe fallback silencioso. Las garantías reales de PostgreSQL quedan pendientes del workflow de integración; los tests locales usan dobles.

## Contratos y composición

PaymentService conserva validación del request y la simulación local; PaymentStore posee exclusión, almacenamiento y Replay. La key se normaliza con trim y es única por Order. Ownership precede al acceso al historial. Una key resuelta devuelve siempre su PaymentResult original, incluso si cambia únicamente el scenario solicitado o después de que otro intento confirme la Order. Esta compatibilidad fue aprobada explícitamente por el usuario; Jira no pide inequívocamente conflicto por cambio de scenario. No se asignan Orders legacy sin owner.

Los escenarios APPROVED/DECLINED/ERROR conservan sus estados. PAYMENT_ERROR responde 200 y mantiene PENDING; una nueva key permite Retry tras DECLINED/ERROR. Una Order confirmada rechaza nuevos intentos con 409 ORDER_ALREADY_CONFIRMED, pero permite Replay histórico. Keys iguales en Orders distintas son independientes.

`createCommerceStores()` crea la pareja In-Memory por defecto. La composición explícita de prueba puede usar:

```ts
const { orders, payments } = createCommerceStores('postgresql', database)
const orderService = new OrderService(orders)
const paymentService = new PaymentService(orders, undefined, payments)
```

Ambos repositorios PostgreSQL deben compartir exactamente la misma Database. PaymentService valida que su persistencia pertenezca al OrderStore recibido. Pasar solo un PostgreSQLOrderStore al constructor no selecciona Payments en memoria: falla la configuración. Los servicios predeterminados consumen la única pareja activa `commerceStores`, actualmente In-Memory, en vez de seleccionar cada mecanismo por separado. Crear/importar repositorios no abre conexiones. El ejemplo no se conecta automáticamente a Express ni autoriza una activación.

## Operación transaccional

1. Buscar un Attempt resuelto mediante un lease READ ONLY, verificando propietario antes de leer el historial.
2. En Database.transaction, configurar READ COMMITTED y límites locales. Leer la Order propia con SELECT ... FOR UPDATE NOWAIT.
3. Consultar de nuevo la misma key, en otra sentencia después del lock. Priorizar Replay antes de rechazar CONFIRMED.
4. Ejecutar el Sandbox con un presupuesto acotado. El builder no recibe un client y sus respuestas tardías nunca escriben.
5. Actualizar solo estados/updated_at e insertar el Attempt con el mismo PoolClient. Se reutiliza PostgreSQLOrderStore.updateWithClient, sin llamar su update transaccional desde otra transacción.
6. Responder éxito después de COMMIT. Un fallo previo revierte ambos cambios y libera el lock.

Se conserva el schema de CN-57: seis columnas, PK (order_id, idempotency_key), FK a Orders y constraints del snapshot. El historial es append-only. El procesamiento existe en el lock de la transacción, sin filas PROCESSING durables. No se bloquea payment_attempts con FOR UPDATE ni se requieren permisos nuevos o migrations.

El runtime ya tiene SELECT/INSERT en Attempts y UPDATE de tres columnas de Orders, suficiente para FOR UPDATE en Orders. El acceso ajeno devuelve 404; 55P03 en la adquisición del lock se transforma en PAYMENT_IN_PROGRESS/409 después del rollback. Los errores SQL, parámetros y datos de comprador no se registran ni se envían al Client. Los fallos de persistencia son HTTP 503 UNEXPECTED_ERROR, separados de PAYMENT_ERROR y de errores inesperados del Sandbox.

## Recovery y límites

Se conservan las categorías internas de timeout, deadlock e indisponibilidad, sin retries comerciales automáticos. El presupuesto dentro del callback es 8000 ms, SQL/control 2000 ms, lock_timeout 1000 ms e idle en transacción 8000 ms; son opciones internas de construcción. Pool acquisition y cleanup/reconciliación tienen sus propios límites: no se promete respuesta HTTP antes del timeout del Client bajo una caída de red.

Ante COMMIT incierto, el helper descarta la conexión original. El repositorio adquiere otra conexión, ejecuta BEGIN READ ONLY, comprueba ownership, consulta la misma Order/key y termina con ROLLBACK. Solo un Attempt válido recupera el resultado. Una lectura vacía, fallo de conexión o snapshot inválido conserva HTTP 503 con error.outcome = unknown. No se infiere éxito a partir de una Order CONFIRMED ni rollback a partir de una ausencia inmediata.

Un Retry explícito conserva key y escenario. La nueva transacción solo puede procesar después de adquirir el lock y consultar nuevamente el historial; así se espera la resolución real del intento anterior sin recrear automáticamente operaciones inciertas. No hay generación de keys ni reprocesamientos en segundo plano. Respuestas HTTP perdidas y repositorios recreados recuperan los resultados confirmados desde PostgreSQL.

El mapper valida unknown → PaymentAttempt/PaymentResult, incluyendo escenario original, resultado, timestamps, campos y estados del snapshot. No reconstruye el histórico desde la Order actual. Preserva precios, importes CRC, Terms y processedAt sin nuevos redondeos. Los campos de tarjeta nunca forman parte del contrato ni de las escrituras.

## Pruebas y CI aislado

El workflow independiente `.github/workflows/server-postgresql-ci.yml` prepara un servicio postgres:17 en un runner Ubuntu. Aplica las dos migrations versionadas únicamente en la base efímera cibernova_test. Las credenciales descartables de CI son distintas para cn_test_admin y cibernova_app, no son secretos de Production y no se reutilizan fuera del contenedor. No se utilizan secretos de GitHub/Supabase ni se llama Algolia real.

Las variables de integración son:

| Variable | Uso |
|---|---|
| RUN_DATABASE_INTEGRATION_TESTS | Opt-in explícito con valor 1 |
| DATABASE_TEST_URL | Administrador de la base efímera, sin fallback al runtime productivo |
| DATABASE_RUNTIME_TEST_URL | cibernova_app de la misma base/host/puerto, contraseña distinta |
| DATABASE_TEST_SSL_MODE | disable exclusivamente para loopback del Runner |
| DOTENV_CONFIG_PATH | Ejemplo sin secretos; nunca el .env privado |

La suite nueva exige loopback, base cibernova_test, administrador cn_test_admin y runtime cibernova_app. La suite CN-57 mantiene su guard original. No usar túneles, credenciales de Supabase ni Production. No relajar estos guards para ejecutar pruebas.

Tras el build, Actions ejecuta los Unit Tests y posteriormente:

```sh
node --test tests/database.integration.test.mjs tests/commerce.integration.test.mjs
```

La integración comprueba concurrencia con Pools independientes, create/replay/ownership de CN-58, tres escenarios, Retry, snapshots históricos tras aprobación, nuevas instancias, bloqueo NOWAIT con permisos runtime, rollback de INSERT y COMMIT rechazado por FK diferible, COMMIT real con ack perdido inyectado y corte de una sesión de test antes de COMMIT. No afirma reproducir un corte TCP exacto durante el COMMIT: esa frontera se inyecta de forma controlada, con el estado final real verificado en PostgreSQL.

Los fixtures de concurrencia necesitan COMMIT real; no pueden ocultarse dentro de un rollback exterior. Se descarta todo el contenedor al finalizar el job. La suite CN-57 también escribe tablas TEMP y cambia roles; las pruebas de permisos incluyen escrituras deliberadamente denegadas. **Ninguna de estas suites es READ-ONLY.**

Para validación local sin PostgreSQL, ejecutar build y las suites Unit siguiendo el procedimiento de Orders Persistence, excluyendo `*.integration.test.mjs` y la prueba de seed que abre explícitamente .env. No ejecutar db:smoke ni configurar URLs reales para estas pruebas.

Workflow preparado, no ejecutado desde Codex. Durabilidad, locks, permisos y Recovery reales siguen pendientes de evidencia de Actions antes de considerar satisfechos todos los Acceptance Criteria o activar PostgreSQL. La integración a dev, PR y activación productiva siguen siendo acciones manuales del usuario y requieren sus validaciones/autorizaciones correspondientes.

## Evidencia local e inventario de CN-59

Validación local del 2026-11-10:

| Verificación | Resultado |
|---|---|
| Server build, TypeScript strict | PASS |
| Server Unit/HTTP Tests seleccionados | 237 PASS, 0 FAIL |
| Client Regression Tests | 363 PASS, 0 FAIL |
| Client lint/build | PASS |
| Integration Tests PostgreSQL / workflow Actions | PENDIENTES; no ejecutados local/remotamente |

La selección local excluye los dos archivos de integración y el test de guardas del seed que abre .env explícitamente. La salida de Node informa 0 skipped porque ese test fue deseleccionado por nombre. Las suites HTTP necesitaron permiso de loopback fuera del sandbox de Windows; no se habilitaron conexiones a servicios externos. El Server no tiene un script de lint independiente; su build valida TypeScript strict.

Archivos añadidos o modificados, desde la raíz del repositorio:

```text
.github/workflows/server-postgresql-ci.yml
server/.env.database.example
server/README.md
server/docs/orders-persistence.md
server/docs/postgresql.md
server/docs/payments-persistence.md
server/src/app.ts
server/src/domain/paymentPersistenceError.ts
server/src/services/orderService.ts
server/src/services/paymentService.ts
server/src/stores/commerceStoreFactory.ts
server/src/stores/commerceStores.ts
server/src/stores/orderRowMapper.ts
server/src/stores/paymentRowMapper.ts
server/src/stores/paymentStore.ts
server/src/stores/postgreSQLOrderStore.ts
server/src/stores/postgreSQLPaymentStore.ts
server/tests/authorization.test.mjs
server/tests/commerce.integration.test.mjs
server/tests/helpers/commerceFixtures.mjs
server/tests/helpers/paymentDatabase.mjs
server/tests/orderCorrections.test.mjs
server/tests/paymentAsync.test.mjs
server/tests/paymentHttpErrors.test.mjs
server/tests/postgreSQLPaymentStore.test.mjs
server/tests/termsAcceptance.test.mjs
```

Además se actualizó AGENTS.md antes de implementar código, con las decisiones aprobadas. Sigue excluido por la regla existente de .gitignore y no aparecerá en el diff versionado; esa exclusión no fue modificada. Sin cambios en migrations, Schema, cálculos financieros, Client, catálogo, Algolia, Inventory/Pricing ni dependencias. Sin stage, commit, push, PR, deployment o escrituras remotas.
