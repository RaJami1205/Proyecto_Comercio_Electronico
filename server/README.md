# CiberNova — Seed de Algolia (CN-20)

La infraestructura PostgreSQL de CN-57 y su procedimiento manual se documentan en [PostgreSQL Foundation](docs/postgresql.md). El comando opt-in `npm run db:smoke` comprueba conectividad READ-ONLY con el runtime `cibernova_app`; requiere configuración privada y autorización previa de la conexión real. No se ejecuta en builds ni al iniciar Express. Los Integration Tests realizan escrituras y no deben ejecutarse contra Production. Orders y Payment continúan utilizando almacenamiento In-Memory hasta CN-58/CN-59.

El seed valida y permite cargar el catálogo canonical desde `data/productos.json`.
El dataset contiene 306 records en un array JSON UTF-8, normalizados desde la
exportación NDJSON UTF-16 LE sin cambiar campos, valores ni objectID.
Este archivo es la fuente de datos del seed; no se utiliza el catálogo demo del cliente.

## Validación local (dry-run por defecto)

Desde `server/`, con las dependencias del proyecto disponibles:

```sh
npm run seed:algolia
```

El script usa el `tsx` ya incluido y resuelve el dataset respecto a su propia
ubicación, independientemente del directorio de trabajo. Valida todos los records,
IDs únicos, campos obligatorios y tipos opcionales antes de cualquier operación externa.
Conserva todos los campos adicionales, sin coerciones ni transformaciones.
Los errores indican posición y campo, sin volcar records.

El dry-run no carga `.env`, no requiere credenciales, no crea un cliente Algolia
y no realiza requests de red. Informa cantidad de records, resultado de validación,
IDs duplicados, modo y `network writes = 0`. Los errores terminan con código 1.

## Escritura explícita

Ejecutar únicamente con autorización para cargar el índice destino. No ejecutar
write mode accidentalmente ni como prueba de validación.

Variables requeridas en el entorno o en `server/.env` (solo se carga en write mode):

| Variable | Propósito |
| --- | --- |
| `ALGOLIA_APP_ID` | Aplicación destino. |
| `ALGOLIA_INDEX_NAME` | Nombre exacto del índice destino. |
| `ALGOLIA_SEED_API_KEY` | Clave separada de escritura, con permiso `addObject` limitado al índice autorizado. |

No se utiliza `ALGOLIA_API_KEY` como alternativa para escritura. No guardar claves
ni otros secretos en Git, en el dataset o en comandos compartidos.

Sintaxis (reemplazar el marcador por el nombre autorizado, no por una credencial):

```sh
npm run seed:algolia -- --write --confirm-index=NOMBRE_DEL_INDICE_AUTORIZADO
```

Se exigen ambas opciones y coincidencia exacta con `ALGOLIA_INDEX_NAME`.
Si falta una credencial o no coincide la confirmación, el script aborta antes
de enviar requests. Opciones desconocidas o repetidas también se rechazan.

La única operación de escritura es `saveObjects`, conservando los objectID y
todos los campos validados. Agrega records nuevos o reemplaza los existentes con
el mismo objectID; no fusiona campos con versiones remotas. Reutilizar IDs evita
duplicaciones por regeneración de identificadores, pero puede sobrescribir cambios
remotos. Los records remotos ausentes del dataset permanecen en el índice.
El script espera la finalización de las tareas; una falla puede dejar una carga
parcial, por lo que debe revisarse el índice antes de reintentar.

No limpia índices, no borra records ni índices y no administra settings,
searchableAttributes, attributesForFaceting, ranking ni réplicas `_price_asc`/`_price_desc`.
La configuración del índice se gestiona separadamente.

## Verificación sin escrituras

```sh
npm run seed:algolia
npm run build
```

El build incluye `src/scripts/seedAlgolia.ts`. Estas comprobaciones no prueban
credenciales ni configuración remota y no requieren ejecutar write mode.

## Órdenes (CN-28)

- POST /api/orders recibe buyer, delivery, items [{ productId, quantity }] e idempotencyKey. Devuelve el snapshot Order con 201, incluso al repetir la clave.
- GET /api/orders/:orderId devuelve ese snapshot con 200, o ORDER_NOT_FOUND con 404.
- El servidor consulta cada objectID en Algolia; nunca utiliza precios o totales del request. Producto inexistente: PRODUCT_NOT_FOUND (404); datos inválidos: CHECKOUT_VALIDATION_ERROR o EMPTY_CART (400).
- Los importes se calculan en centavos, con redondeo a dos decimales y el IVA de 13% redondeado sobre el subtotal. Shipping: 3500 CRC para subtotal mayor que cero y menor que 100000 CRC; cero en los demás casos.
- Order y claves de idempotencia viven únicamente en memoria y se pierden al reiniciar. Las solicitudes simultáneas con una misma clave comparten la creación; un fallo libera la clave para reintentar. La clave debe ser única por compra; reutilizarla devuelve la orden original aun si cambia el payload válido.
- No se procesa ningún pago. OrderStatus y PaymentStatus comienzan en PENDING.

Ejemplo de cuerpo (usar un productId real del catálogo):

```json
{
  "buyer": { "fullName": "Usuario de prueba", "email": "usuario@example.com", "phone": "88888888" },
  "delivery": { "province": "San José", "canton": "San José", "address": "Dirección ficticia" },
  "items": [{ "productId": "ID_REAL", "quantity": 2 }],
  "idempotencyKey": "compra-unica-001"
}
```

Verificación focalizada de CN-28 sin requests a Algolia ni pagos:

```sh
npm run build
node --test tests/orders.test.mjs
```

## Payment Sandbox (CN-30)

POST /api/orders/:orderId/payment recibe únicamente scenario e idempotencyKey:

```json
{ "scenario": "PAYMENT_APPROVED", "idempotencyKey": "payment-attempt-001" }
```

El servicio deriva orderId, amount (order.totals.total) y currency de la Order almacenada. Ignora importes y estados del request. No usa pasarelas externas ni datos financieros reales. El Sandbox simula una espera de 100 ms y devuelve determinísticamente el escenario solicitado.

| scenario | paymentStatus | orderStatus | Retry con nueva clave |
| --- | --- | --- | --- |
| PAYMENT_APPROVED | APPROVED | CONFIRMED | No |
| PAYMENT_DECLINED | DECLINED | PENDING | Sí |
| PAYMENT_ERROR | ERROR | PENDING | Sí |

Los tres resultados responden 200 con PaymentResult { result, processedAt, order }. PAYMENT_ERROR es un resultado simulado, distinto de un fallo real del servidor (500 UNEXPECTED_ERROR). GET /api/orders/:orderId refleja los estados actualizados.

Las claves de pago se aíslan por orden. Repetir una clave procesada devuelve una copia del resultado histórico y no ejecuta nuevamente el Sandbox, aunque la orden se haya aprobado o tenga un Retry posterior. Una clave nueva sobre una orden confirmada devuelve 409 ORDER_ALREADY_CONFIRMED. Reutilizar una clave con otro scenario devuelve su resultado original.

Mientras se procesa una orden, cualquier intento no procesado (incluso con la misma clave en curso) devuelve 409 PAYMENT_IN_PROGRESS. El lock se adquiere antes del primer await y se libera en finally. DECLINED y ERROR permiten intentar nuevamente sobre la misma orden con una clave nueva. Los resultados y locks son in-memory, como las órdenes, y se pierden al reiniciar; las garantías aplican a una única instancia del servidor.

Validaciones: orden inexistente (404 ORDER_NOT_FOUND), scenario inválido (400 INVALID_PAYMENT_SCENARIO), cuerpo o clave inválida (400 CHECKOUT_VALIDATION_ERROR). Los errores usan ApiErrorResponse sin detalles internos.

Verificación completa del backend:

```sh
npm run build
node --test tests/*.test.mjs
```

Esta Story no incorpora interfaz de pagos, Confirmation Page ni limpieza del carrito.

## Usuarios simulados (CN-52)

Las identidades de la simulación residen en un índice Algolia `users`, separado del catálogo. No hay contraseñas, tokens ni sesiones: esto **no es autenticación real**. El Login simulado, `SessionContext` y RBAC pertenecen a Issues posteriores.

### Configuración

| Variable | Propósito |
| --- | --- |
| `ALGOLIA_USERS_INDEX_NAME` | Nombre del índice de usuarios. No puede coincidir con `ALGOLIA_INDEX_NAME` ni con sus réplicas `_price_asc`/`_price_desc`. |

Las lecturas reutilizan `ALGOLIA_APP_ID` y `ALGOLIA_API_KEY`; esa clave debe tener permiso `search` sobre este índice. Si falta la variable, los endpoints de usuarios responden 503 y el catálogo sigue funcionando.

### Preparar los usuarios

`data/users.json` contiene cuatro records con `objectID` estables: un B2C, un B2B con Company, un ADMIN y un B2C deshabilitado para evaluar el rechazo. Forma del record: `objectID`, `displayName`, `role`, `enabled` y `company` (solo B2B, con `id` y `name`).

1. Validar sin red, sin `.env` y sin credenciales:

   ```sh
   npm run seed:users
   ```

   Rechaza IDs duplicados o inválidos, roles desconocidos, Company inválida o presente fuera de B2B, cualquier campo fuera del contrato (por ejemplo `password` o `email`) y la falta de un usuario habilitado de cada rol.

2. Solo con autorización para el índice destino, definir `ALGOLIA_USERS_INDEX_NAME`, `ALGOLIA_INDEX_NAME` (para la protección del catálogo), `ALGOLIA_APP_ID` y `ALGOLIA_SEED_API_KEY`. La clave necesita `addObject` sobre el índice de usuarios. No ejecutar contra producción sin aprobación explícita.

   ```sh
   npm run seed:users -- --write --confirm-index=NOMBRE_DEL_INDICE_DE_USUARIOS
   ```

   Aborta antes de enviar requests si la confirmación no coincide exactamente, si el destino es el índice de productos o una réplica, o si falta una variable. No usa `ALGOLIA_API_KEY` como alternativa.

La única escritura es `saveObjects`: agrega o reemplaza por `objectID`, por lo que repetirla no duplica records. No borra records ni modifica settings, y los records remotos ausentes del archivo permanecen en el índice. Una falla puede dejar una carga parcial.

3. Verificar la carga con el servidor en marcha: `GET /api/users` debe listar tres usuarios, y `POST /api/session/resolve` con `user-b2c-disabled-01` debe responder 403.

### Endpoints

`GET /api/users` responde 200 con `{ "users": ResolvedUser[] }`, solo con usuarios habilitados y válidos, ordenados por `id`. Recupera todas las páginas antes de filtrar. Si los límites de Algolia, un conteo no exhaustivo o páginas inconsistentes impiden verificar el listado completo, responde 503 en lugar de devolver información parcial. Los records inválidos se omiten y se registra únicamente su cantidad.

`POST /api/session/resolve` recibe `{ "userId": "user-b2b-01" }` y responde 200 con el perfil:

```json
{
  "user": {
    "id": "user-b2b-01",
    "displayName": "Compras Empresa Demo",
    "role": "B2B",
    "company": { "id": "company-demo-01", "name": "Distribuidora Demo" }
  }
}
```

Ignora cualquier otro campo del cuerpo, no devuelve `enabled` y no crea tokens, cookies ni sesiones.

| Caso | Estado | Código |
| --- | --- | --- |
| `userId` ausente, con formato inválido o cuerpo no válido | 400 (413 si excede el tamaño) | `INVALID_USER_ID` |
| Usuario inexistente | 404 | `USER_NOT_FOUND` |
| Usuario deshabilitado | 403 | `USER_DISABLED` |
| Rol no reconocido | 422 | `UNKNOWN_USER_ROLE` |
| Company inválida en B2B | 422 | `INVALID_B2B_DATA` |
| Otro dato inválido en el record | 422 | `INVALID_USER_DATA` |
| Fallo de Algolia o configuración incompleta | 503 | `USER_SERVICE_UNAVAILABLE` |

Los errores usan `ApiErrorResponse` sin detalles internos. Ante un 404 al consultar un objeto, una búsqueda sin recuperar hits comprueba que el índice esté disponible: solo entonces se responde `404 USER_NOT_FOUND`. Si el índice está ausente o no está disponible, ambos endpoints responden `503 USER_SERVICE_UNAVAILABLE`. No se consulta la disponibilidad adicionalmente cuando el objeto existe o el error original es distinto de 404.

Verificación sin requests a Algolia:

```sh
npm run build
node --test tests/users.test.mjs
```
