# PostgreSQL Foundation · CN-57

CN-57 incorpora infraestructura Node.js/pg y un chequeo manual de conectividad READ-ONLY. Orders y Payment continúan usando sus Stores In-Memory. La persistencia comercial se conectará en CN-58 y CN-59.

Estado confirmado por el usuario: Supabase PostgreSQL 17.11, un único proyecto remoto Production, schema privado `commerce` y tres tablas. Las migrations `20261109000100_commerce_foundation.sql` y `20261110025043_cibernova_runtime_login.sql` están aplicadas y sincronizadas. El login `cibernova_app` hereda permisos mínimos de `commerce_runtime` y posee contraseña privada propia.

Autenticación mediante Session Pooler en puerto 5432 y TLS 1.3 con CA de Supabase y `sslmode=verify-full` fueron validados con psql 18.6 desde Windows 11/PowerShell. Esto no sustituye la validación con pg. El Smoke Test de Node.js permanece pendiente de ejecución manual autorizada. Este equipo no dispone de Docker, WSL2 ni PostgreSQL local.

## Configuración del Server

Las opciones se leen cuando se usa `database.query`, `database.transaction` o `database.connect`. Importar el módulo y arrancar Express funcionan sin `DATABASE_URL`. El Pool se crea en el primer uso explícito y se reutiliza hasta `database.close()`.

| Variable | Responsabilidad | Default |
|---|---|---|
| `DATABASE_URL` | URL del login runtime de Express | Requerida al usar PostgreSQL |
| `DATABASE_SSL_MODE` | `verify-full` o `disable` exclusivamente en loopback | `verify-full` |
| `DATABASE_CA_CERT` | CA PEM cuando la conexión requiere una CA explícita | Trust store de Node |
| `DATABASE_POOL_MAX` | Máximo de clients por proceso | `3` |
| `DATABASE_CONNECTION_TIMEOUT_MS` | Espera de adquisición/conexión | `5000` |
| `DATABASE_IDLE_TIMEOUT_MS` | Vida ociosa del client | `10000` |
| `DATABASE_STATEMENT_TIMEOUT_MS` | Límite de ejecución de cada sentencia | `15000` |

`server/.env.database.example` contiene solo nombres y defaults. No se carga automáticamente. Configurar las opciones necesarias en `server/.env`, ignorado por Git, mediante un editor privado o variables del proceso. No colocar credenciales en ejemplos, comandos compartidos, historial de PowerShell ni logs. Los valores ya exportados al proceso tienen prioridad sobre dotenv.

`DATABASE_URL` utiliza usuario `cibernova_app.<PROJECT_REF>`, el hostname exacto del Session Pooler ya validado, puerto 5432 y database `postgres`. Codificar los caracteres especiales de usuario/contraseña para una URL. No incluir parámetros SSL en esta URL. El driver recibe los campos separados y el objeto `ssl` explícito, sin una `connectionString` que lo sustituya.

`DATABASE_CA_CERT` contiene el PEM completo con saltos de línea reales, no una ruta ni texto con `\n` literal. Puede conservarse el certificado descargado fuera del repositorio y cargarlo en PowerShell sin mostrar su contenido. Sustituir la ruta de ejemplo por la ubicación privada existente.

```powershell
$env:DATABASE_CA_CERT = Get-Content -LiteralPath 'C:\ruta-privada\supabase-ca.crt' -Raw
```

Configurar `DATABASE_SSL_MODE=verify-full`. El objeto TLS mantiene `rejectUnauthorized: true` y la verificación de hostname del driver. El Smoke Test rechaza TLS desactivado, incluso en loopback. No utilizar `rejectUnauthorized: false` ni deshabilitar verificaciones globales de Node. No se fuerza TLS 1.3 desde el script: la negociación real de pg permanece pendiente de verificar.

Para Render, obtener el host y usuario exactos de **Shared Session Pooler** en el proyecto aprobado de Supabase. El usuario de un login propio a través del pooler incluye el sufijo del proyecto indicado por Supabase. Validar conectividad efectiva, certificado, hostname y capacidad del Pool antes de activar persistencia. Contabilizar la suma de conexiones de todas las instancias de Render.

La configuración TOML de Supabase, reservada para un futuro entorno aislado, utiliza PostgreSQL 17 y deshabilita API, Auth, Storage, Realtime, Studio y Analytics. No representa un stack local disponible en este equipo ni modifica el proyecto remoto. El schema `commerce` debe mantenerse fuera de los schemas expuestos en la Data API.

## Credenciales y permisos

Separar el login privilegiado de migrations del login runtime. La primera migration crea `commerce_runtime` como rol **NOLOGIN**, sin contraseña. La segunda crea `cibernova_app` con LOGIN/INHERIT y pertenencia a ese rol. Su contraseña se configuró privadamente fuera del SQL versionado. La URL runtime corresponde a ese login, sin superuser, creación de roles/databases ni permisos heredados de administración.

La migration concede a `commerce_runtime` USAGE del schema, SELECT/INSERT en las tres tablas y UPDATE únicamente de los estados y `updated_at` de Orders. Los snapshots, propietarios, registros de creación y resultados históricos quedan fuera de sus permisos de actualización. El código de CN-58/CN-59 deberá comprobar ownership, estados y payload canónico en cada operación protegida.

Las credenciales de CLI se administran por separado, por ejemplo mediante `SUPABASE_ACCESS_TOKEN` y `SUPABASE_DB_PASSWORD` en la terminal privada del operador. No se utilizan como alternativas para `DATABASE_URL`. Mantener passwords y tokens fuera de comandos compartidos, SQL, Git, logs y variables `VITE_*`.

## Esquema inicial

La migration `20261109000100_commerce_foundation.sql` crea exactamente tres tablas del dominio.

| Tabla | Contrato |
|---|---|
| `orders` | Snapshot de usuario validado, Buyer/Delivery/items, importes, Terms y contexto versionado, con estados actuales separados |
| `order_creation_requests` | Key global, propietario, payload canónico versionado y referencia única a la Order |
| `payment_attempts` | Key por Order, escenario original, resultado, fecha y snapshot histórico de la Order |

Los IDs públicos se almacenan como TEXT, conforme al DTO actual. El owner coincide con `user_snapshot.id` y admite snapshots B2C/B2B válidos. ADMIN queda excluido como comprador. `branch_id` admite NULL para compatibilidad V1 y los cuatro Branch IDs existentes. Las condiciones V2 quedan para CN-61.

Los importes utilizan NUMERIC sin escala fija y los items conservan sus precios en JSONB. El driver mantiene su parser NUMERIC a string. CN-58 deberá proyectar y validar esos valores al DTO `number`. La suite de integración preparada cubre el round-trip de precios con más de dos decimales, pendiente de ejecución contra PostgreSQL aislado. La migration no recalcula importes ni añade redondeos. Los timestamps utilizan precisión de milisegundos.

La key de creación es global. Cambiarla a una UNIQUE por usuario alteraría CN-54. Su FK compuesta y diferible vincula Order y owner dentro del mismo COMMIT. La fecha y versión de Terms permanecen históricas. Los estados permiten PENDING con pago PENDING/DECLINED/ERROR y CONFIRMED únicamente con APPROVED.

El Replay de creación debe recuperar la misma Order con su estado actual. Payment Replay debe recuperar el resultado original, incluido su snapshot, incluso después de otra aprobación. El escenario almacenado corresponde al intento original. Reutilizar una key no debe sustituir el resultado histórico por el escenario de la nueva solicitud.

La migration tiene dos bloques DO anónimos para preparar/restringir roles. No crea Functions, Stored Procedures ni Triggers persistentes. Supabase CLI administra su propio historial de migrations fuera de `commerce`.

## Consultas y transacciones

Usar SQL interno parametrizado y nombres de tabla cualificados con `commerce`. En un callback de `database.transaction`, todas las sentencias utilizan el PoolClient recibido. El helper administra BEGIN/COMMIT/ROLLBACK/release y no reejecuta callbacks.

Los errores se proyectan a `DatabaseError` con categoría, resultado transaccional y SQLSTATE cuando existe. No conservan mensajes, causas, SQL ni parámetros del driver. Un ROLLBACK fallido provoca descarte del client. Una pérdida de respuesta durante COMMIT conserva `outcome = unknown`, incluso si un ROLLBACK posterior responde. CN-58/CN-59 deberán reconciliar mediante la misma key. El helper tampoco acepta un command tag ROLLBACK como confirmación de COMMIT.

SIGINT/SIGTERM detienen la admisión HTTP y cierran el Pool si se utilizó. La configuración PostgreSQL no afecta las rutas comerciales actuales.

## Smoke Test manual READ-ONLY

Este comando abre una única conexión mediante `Database.connect()` y `getDatabaseConfig`, con máximo de Pool igual a 1 exclusivamente para este proceso. No usa el helper transaccional comercial, que administra BEGIN/COMMIT. Carga explícitamente `server/.env` mediante dotenv con salida silenciosa. Importar su módulo no carga dotenv ni ejecuta el comando.

Desde `server/`, únicamente después de revisar el diff, configurar las credenciales privadas y autorizar la conexión real:

```sh
npm run db:smoke
```

El comando usa el tsx existente y no necesita build previo. No acepta argumentos ni ejecuta seeds, migrations o Integration Tests. No está conectado a Express, builds, unit tests, deployments ni scripts de instalación. Las pruebas unitarias de este módulo utilizan dobles de Pool sin invocar el entry point CLI.

Las únicas sentencias son las siguientes, sobre el mismo PoolClient:

```sql
BEGIN READ ONLY;
SELECT current_user, current_database(),
       current_setting('transaction_read_only') AS transaction_read_only;
SELECT 1 AS access_ok FROM commerce.orders LIMIT 1;
ROLLBACK;
```

Valida `current_user = cibernova_app` y `transaction_read_only = on` antes de consultar Orders. Cero filas en `commerce.orders` es un resultado válido. No lee columnas ni snapshots comerciales. Siempre intenta ROLLBACK tras adquirir el client, lo libera y cierra el Pool. Si ROLLBACK falla, descarta el client. No realiza reintentos.

PASS se imprime solo tras completar consultas y cleanup. FAIL termina con exit code 1 y un mensaje sanitizado, sin DSN, certificados, contraseñas, filas de configuración ni stack del driver. Este chequeo no demuestra persistencia de Orders/Payment, concurrencia, durabilidad ni el funcionamiento completo de las constraints.

## Validación local

Desde `server/`, con dependencias instaladas mediante el lockfile del proyecto.

```sh
npm run build
```

Las suites anteriores no conectan PostgreSQL y no ejecutan el comando manual. Para validar sin leer `server/.env`, dirigir dotenv al ejemplo sin secretos durante la ejecución local de tests:

```powershell
$env:DOTENV_CONFIG_PATH = Join-Path (Get-Location) '.env.database.example'
node --test tests/database.test.mjs tests/databaseSmokeTest.test.mjs
Remove-Item Env:DOTENV_CONFIG_PATH
```

**Prohibido ejecutar Integration Tests contra Production.** Realizan CREATE TEMP TABLE, INSERT/UPDATE, COMMIT de probes temporales, savepoints y cambios de rol. Revertir fixtures no los convierte en READ-ONLY. No hay limpieza con DELETE/TRUNCATE/DROP ni aplicación automática de migrations, pero sí escrituras y bloqueos durante su ejecución. La cuenta runtime no tiene los permisos administrativos que algunas assertions necesitan. No ampliar sus permisos para ejecutar esta suite.

`npm run test:database` incluye el archivo de integración. Su guard exige opt-in y una base **aislada de loopback**, con las migrations aplicadas manualmente. Nunca utiliza `DATABASE_URL` como alternativa. Mantener `RUN_DATABASE_INTEGRATION_TESTS=0` y `DATABASE_TEST_URL` sin configurar en el entorno actual. No utilizar túneles a Production ni debilitar el guard.

| Variable de integración | Responsabilidad |
|---|---|
| `RUN_DATABASE_INTEGRATION_TESTS` | Opt-in explícito con `1` |
| `DATABASE_TEST_URL` | Conexión exclusiva a PostgreSQL aislado local |
| `DATABASE_TEST_SSL_MODE` | `disable` por defecto para loopback, o `verify-full` si el servidor local usa TLS |

La cuenta de tests necesita permisos sobre la base aislada y capacidad de asumir `commerce_runtime`. Las pruebas usan transacciones revertidas para fixtures comerciales y tablas temporales eliminadas por PostgreSQL al cerrar sus sesiones. Verifican constraints, FKs, permisos, concurrencia y precisión. Si falla la conexión, la ejecución opt-in falla en vez de declarar PASS. La integración real permanece pendiente hasta disponer de un entorno aislado compatible.

## Aplicación manual de migrations

Supabase CLI está instalado como dependencia de desarrollo de Server. Los comandos siguientes corresponden a **CLI 3.1.0**, fijada por el lockfile. Ejecutarlos desde `server/`.

Las dos migrations de CN-57 ya están aplicadas según confirmación del usuario. No reaplicarlas ni ejecutar CLI para el Smoke Test. El procedimiento siguiente se conserva como referencia para futuros entornos aislados o cambios autorizados. Los pasos del stack local requieren preparar previamente Docker. Las operaciones remotas requieren autorización independiente y no necesitan ese stack local.

1. Revisar el SQL y los permisos. Preparar Docker y un entorno local aislado. El proyecto local se identifica como `cibernova-cn57`.
2. Iniciar el stack local. La configuración deshabilita seeds. El arranque puede aplicar migrations locales pendientes.

```sh
npm run db:cli -- start
```

3. Revisar y aplicar cualquier migration local pendiente. Estas operaciones pueden consultar/modificar exclusivamente la base local seleccionada.

```sh
npm run db:cli -- db push --dry-run --skip-vault
npm run db:cli -- db push --skip-vault
npm run db:cli -- migration list
```

4. Configurar las variables de integración en una terminal privada, ejecutar `npm run test:database` y comprobar que la suite real se ejecuta. Omitida significa pendiente.
5. Para un proyecto remoto, obtener primero aprobación específica del destino, credenciales y SQL. Verificar backup/recuperación y compatibilidad de versión. En CLI v3 el destino remoto requiere `--remote`. Los siguientes son comandos manuales futuros, con `PROJECT_REF` sustituido por la referencia aprobada.

```sh
npm run db:cli -- db push --remote=PROJECT_REF --dry-run --skip-vault
npm run db:cli -- db push --remote=PROJECT_REF --skip-vault
npm run db:cli -- migration list --remote=PROJECT_REF
```

No usar flags de seeds, roles adicionales, Vault ni confirmación automática. Las migrations aplicadas permanecen inmutables en Git. Supabase CLI registra sus versiones. Las correcciones posteriores se añaden como migrations nuevas revisadas. La recuperación debe planificarse con backups y correcciones hacia adelante.

## Referencias

- [Transacciones de node-postgres](https://node-postgres.com/features/transactions)
- [Pool de node-postgres](https://node-postgres.com/apis/pool)
- [TLS de node-postgres](https://node-postgres.com/features/ssl)
- [Conexiones y Session Pooler de Supabase](https://supabase.com/docs/guides/database/connecting-to-postgres)
- [Workflow de migrations de Supabase](https://supabase.com/docs/guides/local-development/cli-workflows)
- [SQLSTATE de PostgreSQL](https://www.postgresql.org/docs/current/errcodes-appendix.html)
