# CN-69 Reporte de Quality Assurance, Testing y Regression

Proyecto CiberNova, Proyecto III. Ejecución del 18 de noviembre de 2026 sobre la rama `feature/proyecto3-tareas-Gerny` (base `0b90fe3`, con CN-62, CN-63 y CN-64) más los ajustes de este CN-69.

## 1. Resumen del estado de calidad

| Indicador | Resultado |
| --- | --- |
| Escenarios E2E documentados | 21 |
| Escenarios PASS | 18 |
| Escenarios FAIL | 0 |
| Escenarios BLOQUEADOS por funcionalidad no implementada | 3 (CN-66, CN-67, CN-68) |
| Tests automatizados del Client | 499 de 499 |
| Tests unitarios del Server | 375 de 375 |
| Tests de integración con PostgreSQL | 22 de 22 |
| Tests E2E de API con PostgreSQL | 19 de 19 |
| Recorridos E2E en navegador | 10 de 10, sin errores de consola |
| Lint y Build del Client | Sin errores |
| Build del Server (chequeo TypeScript estricto) | Sin errores |
| Defectos encontrados | 3, todos corregidos y revalidados |
| Defectos bloqueantes abiertos | 0 |

El alcance implementado del Proyecto III supera las validaciones funcionales, técnicas y transaccionales sin defectos bloqueantes abiertos. La aprobación final queda condicionada a dos pendientes que no son defectos sino funcionalidades sin integrar todavía.

1. Admin Panel (CN-66, CN-67 y CN-68) y la sincronización de Orders hacia un índice de Algolia. No existen en el código revisado, por lo que sus escenarios quedan BLOQUEADOS y deben ejecutarse cuando se integren.
2. La integración con los índices reales de Algolia. Se validó con un catálogo simulado que reproduce las consultas del Server, porque este ambiente no usa credenciales productivas. Debe confirmarse en un ambiente con credenciales de solo lectura antes del Deployment (CN-71).

## 2. Ambiente y datos de prueba

| Elemento | Detalle |
| --- | --- |
| Node.js | v22.23.5 local (la CI usa Node 24) |
| PostgreSQL | 16.15 local, base efímera `cibernova_test` con las tres migraciones y el rol runtime `cibernova_app`, igual que el job de CI (que usa PostgreSQL 17) |
| Navegador | Google Chrome 153 en modo headless |
| Algolia | Catálogo QA en memoria (`server/tests/helpers/fakeAlgoliaCatalog.mjs`). Ningún índice productivo fue consultado ni modificado |
| Usuarios | Directorio simulado con B2C, segundo B2C, B2B con empresa, ADMIN y una cuenta deshabilitada |
| Productos | 8 productos sintéticos con precio Retail, precio Wholesale, MOQ de 1 a 10, un producto sin condición B2B y un producto agotado en todas las sucursales |
| Pagos | Payment Sandbox local. Los campos de tarjeta son demostrativos y no se transmiten al Server |

No se ejecutaron pruebas sobre producción ni se usaron credenciales reales. La única credencial presente es la descartable del contenedor de CI, ya pública en el workflow.

### Nota sobre AGENTS.md

El Technical Preflight pide leer `AGENTS.md`, pero el `.gitignore` de la raíz lo excluye del repositorio. Este QA se hizo leyendo el código, la CI y la documentación de `server/docs`. Si el archivo local del equipo define reglas adicionales, conviene revisarlas contra este reporte.

## 3. Matriz de escenarios End-to-End

Cada escenario se validó con dos tipos de evidencia. Los IDs E2E corresponden a la suite automatizada `server/tests/e2e.integration.test.mjs`, que usa los servicios HTTP reales del Client contra Express y PostgreSQL. Los IDs UI corresponden a recorridos en Chrome real con capturas en `docs/qa/evidencias/capturas`.

| ID | Escenario | Resultado esperado | Resultado obtenido | Estado | Evidencia |
| --- | --- | --- | --- | --- | --- |
| ESC-01 | Simulated Login B2C | El Server resuelve la identidad B2C y el Header la muestra | Identidad Cliente QA con rol B2C. Las cuentas deshabilitadas no se ofrecen | PASS | E2E-01, UI-01 |
| ESC-02 | Simulated Login B2B | Identidad B2B con la empresa validada por el Server | Compras Empresa QA con Distribuidora QA | PASS | E2E-02, UI-07 |
| ESC-03 | Simulated Login ADMIN | Identidad ADMIN y rechazo de cuentas deshabilitadas | ADMIN resuelto y cuenta deshabilitada rechazada | PASS | E2E-03, UI-09 |
| ESC-04 | RBAC y accesos no autorizados | ADMIN no compra ni paga ni usa My Orders, los compradores no ven Orders ajenas | 403 para ADMIN al comprar, pagar y listar historial. 404 al consultar o pagar Orders ajenas. 401 sin identidad y 403 para la cuenta deshabilitada. ADMIN redirigido al catálogo desde #my-orders | PASS | E2E-04, UI-09 |
| ESC-05 | Catálogo con precios Retail | Anónimo y B2C ven precio Retail | Todos los productos con tipo RETAIL y precio del catálogo | PASS | E2E-05, UI-01 |
| ESC-06 | Catálogo con precios Wholesale | B2B ve precio mayorista y no puede agregar productos sin condición B2B | SSD a ₡39 000 WHOLESALE y Mouse bloqueado | PASS | E2E-06, UI-07 |
| ESC-07 | MOQ B2B | Bajo el mínimo se rechaza sin crear Order y en el mínimo se acepta | 2 unidades rechazadas con INVALID_MOQ y sin fila nueva, 3 unidades aceptadas | PASS | E2E-07, UI-08 |
| ESC-08 | Sucursal e inventario | La disponibilidad cambia según la sucursal elegida | SSD con 2 unidades en Alajuela y agotado en Cartago | PASS | E2E-08, UI-02 |
| ESC-09 | Rechazo por inventario insuficiente | El Server rechaza y el carrito impide superar las existencias | INSUFFICIENT_INVENTORY sin crear Order y carrito limitado a 2 unidades en Alajuela | PASS | E2E-09, UI-06 |
| ESC-10 | Shopping Cart del usuario correcto | El carrito pertenece a su identidad y se limpia solo lo comprado | Carrito asociado a la identidad, inactivo para otras y limpio tras la compra aprobada | PASS | UI-02, UI-03 y suites del Client `safeCartCleanup`, `cartCleanup` y `session` |
| ESC-11 | Compra B2C completa | Checkout V2 crea la Order con importes Retail y el pago aprobado la confirma | Order V2 RETAIL en San José, totales iguales al cálculo del Client y estado CONFIRMED | PASS | E2E-11, UI-03 |
| ESC-12 | Compra B2B completa | Order con Wholesale, MOQ y empresa histórica, confirmada por el pago | Precios 64 000 y 33 000, empresa en el snapshot y Order confirmada | PASS | E2E-12, UI-08 |
| ESC-13 | Persistencia de Orders en PostgreSQL | La fila guarda propietario, sucursal, tipo de precio, estados y total | Fila verificada con el rol administrador de la base efímera | PASS | E2E-13 |
| ESC-14 | Payment Sandbox APPROVED, DECLINED y ERROR | Rechazo y error dejan la Order pendiente, la aprobación la confirma y los intentos quedan persistidos | 3 Payment Attempts en PostgreSQL, Retry con key nueva y bloqueo de pagos sobre Orders confirmadas | PASS | E2E-14, UI-03 |
| ESC-15 | Order Idempotency, Retry y Replay | Repetir la misma key no duplica Orders ni pagos, un payload distinto con la misma key se rechaza | Misma Order en el Replay, una sola fila, conflicto IDEMPOTENCY_CONFLICT, Replay de pago sin volver al Sandbox. Con 6 requests concurrentes se creó una sola Order y con 4 pagos concurrentes un solo Attempt | PASS | E2E-15, E2E-18 |
| ESC-16 | Order History y Orders propias | Cada comprador ve solo sus Orders, recientes primero, con detalle autorizado | Historial propio ordenado y paginado, detalle con snapshot histórico, recarga directa recuperada | PASS | E2E-16, UI-04, UI-05 |
| ESC-17 | Consulta administrativa global de Orders | Listado global para ADMIN | La funcionalidad no existe. Solo existe la consulta individual por ID del CN-63, que sí se validó | BLOQUEADO | Pendiente CN-66 |
| ESC-18 | Consulta administrativa de productos e inventario | Panel ADMIN de productos y existencias | La funcionalidad no existe en el código | BLOQUEADO | Pendiente CN-67 |
| ESC-19 | Modificación administrativa simulada y Reset | Cambios simulados que no alteran el inventario autoritativo | La funcionalidad no existe en el código | BLOQUEADO | Pendiente CN-68 |
| ESC-20 | Recuperación después de reiniciar el Server | Historial, detalle y Replay disponibles tras reiniciar Node.js | Pool y stores nuevos en la suite, y proceso del Server reiniciado en el navegador. Datos recuperados desde PostgreSQL sin consultar el catálogo | PASS | E2E-17, UI-10 |
| ESC-21 | Regresión de búsqueda, filtros, orden y paginación | Sugerencias con highlight, filtro por categoría, orden por precio y páginas correctas | Resultados correctos en las cuatro funciones | PASS | E2E-19 |

## 4. Integration Testing

| Integración | Estado | Evidencia |
| --- | --- | --- |
| React y Express | PASS | Suite E2E con los servicios reales del Client y recorridos en navegador |
| Express y Algolia | PASS con catálogo simulado. PENDIENTE con índices reales | E2E-05, E2E-06, E2E-19. Requiere confirmación con credenciales de solo lectura |
| Express y PostgreSQL | PASS | Integración 22 de 22 y E2E 19 de 19 con rol runtime separado |
| Session y Shopping Cart | PASS | Suites del Client `session`, `cartCleanup`, `safeCartCleanup` y UI-02 |
| Pricing e Inventory | PASS | E2E-06 a E2E-09, `pricingInventory` y `productServicePricing` |
| Shopping Cart y Checkout | PASS | `checkoutV2`, `cartRevalidation` y UI-03 |
| Checkout y OrderService V2 | PASS | E2E-11, E2E-12 y `orderApi` |
| OrderService y PostgreSQL | PASS | E2E-13, E2E-15 y `commerce.integration` |
| PaymentService y PostgreSQL | PASS | E2E-14, E2E-18 y `postgreSQLPaymentStore` |
| PostgreSQL y Algolia Orders Index | BLOQUEADO | No existe `OrderIndexSyncService` ni un índice de Orders en el código |
| Admin Dashboard y APIs administrativas | BLOQUEADO | Pendientes CN-66, CN-67 y CN-68. El Analytics Dashboard existente sí se validó en UI-09 |
| Errores de conexión y respuestas inesperadas | PASS | `paymentAsync`, `paymentHttpErrors`, `termsContract` (CN-58 outcome unknown), `checkoutCorrections` y `checkoutV2` en el Client |

## 5. Regression Testing

| Funcionalidad heredada | Estado | Evidencia |
| --- | --- | --- |
| Product Listing | PASS | UI-01, UI-07 y `productController` |
| Search y filtros de Algolia | PASS | E2E-19, `analyticsSearch` y `sessionCatalog` |
| Ordenamiento y paginación | PASS | E2E-19 y `productController` |
| Product Quick View | PASS | `cartProductViews` y `analyticsStorefront` |
| Shopping Cart | PASS | UI-02 y `cartRevalidation` |
| Persistencia y restauración del carrito | PASS | `cartCleanup` y `session` |
| Safe Cart Cleanup | PASS | UI-03 y `safeCartCleanup` |
| Checkout Buyer y Delivery | PASS | UI-03 y `checkoutCorrections` |
| Review y Payment | PASS | UI-03, UI-08 y `paymentIntegrity` |
| Terms Acceptance | PASS | `termsAcceptance`, `termsContract` y `termsDialog` |
| Order Idempotency | PASS | E2E-15 y E2E-18 |
| Payment Retry y Replay | PASS | E2E-14, E2E-15 y `payments` |
| Subtotal, impuestos, envío y total | PASS | `cartCalculations`, `orderSnapshot` y el Review B2B con envío gratis desde ₡100 000 |
| Navegación y responsive | PASS | `policyNavigation`, `analyticsDashboard`, `orderHistory` y capturas de la sección 7 |

No se modificaron reglas comerciales ni financieras. Los tests existentes que cambiaron durante el Proyecto III se ajustaron por cambios legítimos de contrato documentados en sus commits, sin eliminar garantías.

## 6. Transactional Testing

| Garantía | Estado | Evidencia |
| --- | --- | --- |
| Requests concurrentes | PASS | E2E-18 y `commerce.integration` CN-58 |
| Prevención de Orders duplicadas | PASS | E2E-15 y E2E-18 |
| Recuperación tras fallos de conexión | PASS | `paymentAsync`, `termsContract` CN-58 y `checkoutV2` resultado incierto |
| Replay con snapshots históricos | PASS | E2E-15, E2E-17 y `commerce.integration` CN-61 |
| Persistencia de Payment Attempts | PASS | E2E-14 y `postgreSQLPaymentStore` |
| Actualizaciones atómicas de Order y Payment | PASS | `commerce.integration`, subtests de fallo INSERT y COMMIT diferido que revierten estados y Attempt juntos, y de NOWAIT entre Pools |
| Protección de operaciones pendientes | PASS | `checkoutV2` bloqueo de sucursal y `session` bloqueo de identidad |
| Autorización de propietario | PASS | E2E-04, `orderOwnership` y `authorization` |
| Consistencia eventual entre PostgreSQL y Algolia | BLOQUEADO | No existe sincronización de Orders hacia Algolia |

## 7. UI, UX y Responsive

Validado en Chrome con 1440 px (Desktop), 820 px (Tablet) y 390 px (Mobile).

| Pantalla | Desktop | Tablet | Mobile | Observación |
| --- | --- | --- | --- | --- |
| Catálogo B2C | UI-01 | UI-01 | UI-01 | Precios Retail y disponibilidad por sucursal legibles |
| Catálogo B2B | UI-07 | | UI-07 | Precio mayorista y bloqueo de productos sin condición B2B |
| Carrito | UI-02 | UI-02 | UI-02 | Controles de cantidad respetan existencias |
| Review del Checkout | UI-03, UI-08 | | UI-03 | Cuenta, empresa, sucursal, MOQ y aviso de revalidación |
| Pago rechazado y Retry | UI-03 | | | Mensaje claro y acción Intentar nuevamente |
| Confirmación | UI-03 | | UI-03 | Carrito limpio después de aprobar |
| Mis órdenes | UI-04 | UI-04 | UI-04 | Dos columnas en Desktop y una en Tablet y Mobile |
| Detalle de la orden | UI-04, UI-08 | UI-04 | UI-04, UI-08 | En Mobile la tabla de productos pasa a filas apiladas |
| Sesión requerida | UI-05 | | | Invitación a elegir identidad tras recargar |
| Analytics ADMIN | UI-09 | | UI-09 | Sin acceso a Mis órdenes |

Los recorridos no registraron errores de consola ni excepciones de página.

## 8. CI Validation

| Check | Client | Server |
| --- | --- | --- |
| Lint | Sí, `npm run lint` | No existe script de lint. Se recomienda agregarlo en una tarea aparte |
| TypeScript Checks | Sí, dentro de `npm run build` (`tsc -b`) | Sí, `npm run build` con TypeScript estricto |
| Build | Sí | Sí |
| Automated Tests | Agregado en este CN-69 (job `test`) | Unitarios en cada PR |
| Integration y E2E con PostgreSQL | No aplica | Integración en cada PR y la suite E2E agregada en este CN-69 |

La CI no depende de servicios productivos. PostgreSQL es un contenedor efímero del Runner y Algolia se simula en las suites. Los cambios de workflow se validaron localmente con los mismos comandos y deben confirmarse en la primera ejecución del Pull Request.

## 9. Registro de defectos

| ID | Funcionalidad | Pasos para reproducir | Esperado | Obtenido | Severidad | Corrección | Revalidación |
| --- | --- | --- | --- | --- | --- | --- | --- |
| DEF-01 | CI del Client | Abrir un PR hacia dev y revisar los jobs de Client CI | Lint, Build y Tests del Client | Solo Lint y Build, los 499 tests del Client nunca corrían en CI | Alta | Job `test` en `.github/workflows/client-ci.yml` | 499 de 499 local con el mismo comando. Pendiente confirmar en el PR |
| DEF-02 | Contratos Client y Server de Orders | Ejecutar los unit tests del Server después del CN-62 | `termsContract` en verde | 2 fallas porque el Client pasó a Orders V2 y la prueba seguía en V1 | Alta | Commit `0a46adb` ajusta la prueba al contrato V2 sin quitar garantías | 375 de 375 |
| DEF-03 | Order Detail por link directo | Abrir `#my-orders/` con un Order ID que contenga una barra codificada, o volver con Back | El detalle de la Order | Volvía al catálogo porque el ID decodificado se rechazaba | Media | Corregido en `appNavigation.ts` antes del commit `0b90fe3` | `orderHistory` del Client y UI-05 |

## 10. Observaciones no bloqueantes

| ID | Observación | Recomendación |
| --- | --- | --- |
| OBS-01 | El Simulated Login no se restaura al recargar, por diseño. Las Orders sí persisten y se recuperan al elegir la identidad (UI-05) | Mantener. Es coherente con no guardar sesiones en el navegador |
| OBS-02 | `.env.database.example` mantiene `ORDER_CREATION_MODE=v1-compatible` aunque el Client ya usa Orders V2 | Configurar `v2-only` en el Deployment (CN-71) |
| OBS-03 | El Server no tiene lint | Agregar ESLint al Server en una tarea propia |
| OBS-04 | La confirmación de compra muestra la navegación completa del catálogo en el Header | Comportamiento previo. Sin impacto funcional |

## 11. Cómo reproducir

```bash
# Client
cd client && npm ci && npm run lint && npm run build && node --test

# Server, unitarios
cd server && npm ci && npm run build
DOTENV_CONFIG_PATH=.env.database.example CLIENT_ORIGIN=http://localhost:5173 RUN_DATABASE_INTEGRATION_TESTS=0 \
  node --test $(ls tests/*.test.mjs | grep -v integration)

# Server, integración y E2E contra la base efímera local (nunca producción)
DOTENV_CONFIG_PATH=.env.database.example CLIENT_ORIGIN=http://localhost:5173 \
DATABASE_SSL_MODE=disable DATABASE_TEST_SSL_MODE=disable RUN_DATABASE_INTEGRATION_TESTS=1 \
DATABASE_TEST_URL=postgresql://cn_test_admin:ci-admin-ephemeral-only@127.0.0.1:5432/cibernova_test \
DATABASE_RUNTIME_TEST_URL=postgresql://cibernova_app:ci-runtime-ephemeral-only@127.0.0.1:5432/cibernova_test \
  node --test tests/database.integration.test.mjs tests/commerce.integration.test.mjs tests/e2e.integration.test.mjs
```

El E2E en navegador se reproduce con `docs/qa/herramientas`, según su README.

## 12. Evidencias

| Archivo | Contenido |
| --- | --- |
| `evidencias/01-client-lint.txt` | Lint del Client |
| `evidencias/02-client-build.txt` | Build del Client |
| `evidencias/03-client-tests.txt` | 499 tests del Client |
| `evidencias/04-server-build.txt` | Build y chequeo TypeScript del Server |
| `evidencias/05-server-unit-tests.txt` | 375 tests unitarios del Server |
| `evidencias/06-server-integration-tests.txt` | 22 tests de integración con PostgreSQL |
| `evidencias/07-e2e-api-tests.txt` | 19 tests E2E de API con PostgreSQL |
| `evidencias/08-e2e-navegador-resultados.json` | Resultado esperado, obtenido, estado y capturas de UI-01 a UI-10 |
| `evidencias/capturas/` | 28 capturas en Desktop, Tablet y Mobile |

## 13. Aprobación

El resultado de este QA debe ser aprobado por el equipo antes del Deployment definitivo. Antes de esa aprobación conviene integrar CN-66, CN-67 y CN-68, ejecutar ESC-17, ESC-18 y ESC-19, y confirmar la integración con los índices reales de Algolia.
