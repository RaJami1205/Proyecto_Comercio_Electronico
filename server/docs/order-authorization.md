# Order Ownership y Payment Authorization (CN-63)

Control de acceso basado en Simulated Login. La identidad llega en el header `X-CiberNova-User-Id` y UserService la valida contra el índice users. No es autenticación segura de producción, no usa JWT, OAuth ni contraseñas, y cualquier cliente puede elegir una identidad del directorio simulado.

## Matriz RBAC

La matriz vive en `src/domain/orderAccess.ts` y es la única fuente de permisos para Orders y Payment.

| Rol | checkout:create | orders:read:own | orders:read:all |
| --- | --- | --- | --- |
| B2C | sí | sí | no |
| B2B | sí | sí | no |
| ADMIN | no | no | sí |

Payment no tiene un permiso propio. El Technical Preflight no encontró una necesidad real, porque procesar un pago es parte de comprar. Por eso Payment exige `checkout:create` más la propiedad de la Order.

## Rutas

| Ruta | Quién puede usarla | Regla |
| --- | --- | --- |
| `POST /api/v2/orders` | B2C, B2B | `checkout:create` |
| `GET /api/v2/orders/:orderId` | B2C, B2B, ADMIN | B2C y B2B solo su Order, ADMIN cualquiera |
| `POST /api/orders` (legacy) | B2C | Compatibilidad V1 sin cambios |
| `GET /api/orders/:orderId` (legacy) | B2C, B2B | Solo el propietario |
| `POST /api/orders/:orderId/payment` | B2C, B2B | `checkout:create` y propietario |

Las rutas legacy se mantienen bajo una política de compatibilidad explícita. Solo aceptan compradores y la lectura se limita al propietario. ADMIN consulta únicamente por la ruta V2.

## Cómo se decide la propiedad

1. El middleware resuelve la identidad una sola vez por request (`authorizeIdentity` o `authorizeRoles`).
2. `requirePermissions` exige el permiso de la ruta sobre esa identidad, sin volver a consultar UserService.
3. `OrderService.findAuthorized` obtiene el alcance con `orderReadScope`. ADMIN lee con `findById` y los compradores con `findByIdForOwner`.
4. El propietario se compara con el `owner_user_id` guardado en PostgreSQL (o el owner del store In-Memory). Nunca se usa un `userId` del body ni Algolia.

Las futuras Stories de Order History y Admin Panel deben reutilizar `orderReadScope` para filtrar sus consultas, en lugar de repetir reglas en cada Controller.

## Payment, Retry y Replay

`requirePaymentActor` rechaza a ADMIN con 403 antes de tocar la persistencia. Después, PaymentStore verifica la propiedad dentro de su transacción, antes del Sandbox y antes de devolver un resultado histórico. Así una IdempotencyKey válida no omite la autorización, un Replay ajeno no expone resultados y un Retry con key nueva solo se procesa para el propietario. Los escenarios APPROVED, DECLINED y ERROR, los locks y la concurrencia no cambian.

## Respuestas de error

| Situación | HTTP | Código |
| --- | --- | --- |
| Sin header de identidad | 401 | `IDENTITY_REQUIRED` |
| Header inválido o duplicado | 400 | `INVALID_USER_ID` |
| Usuario inexistente | 404 | `USER_NOT_FOUND` |
| Usuario deshabilitado | 403 | `USER_DISABLED` |
| Rol desconocido | 422 | `UNKNOWN_USER_ROLE` |
| Rol sin permiso (por ejemplo ADMIN pagando) | 403 | `FORBIDDEN` |
| Order inexistente, ajena o sin propietario verificable | 404 | `ORDER_NOT_FOUND` |
| Order propia ya confirmada | 409 | `ORDER_ALREADY_CONFIRMED` |

Una Order inexistente y una Order ajena devuelven exactamente el mismo cuerpo. Así un comprador no puede saber si un ID pertenece a otra persona. El 409 por Order confirmada solo lo recibe el propietario, porque la propiedad se comprueba antes.

La Story usa nombres conceptuales. Su equivalencia con los códigos reales es la siguiente. SESSION_REQUIRED corresponde a `IDENTITY_REQUIRED`. INVALID_USER corresponde a `INVALID_USER_ID`, `USER_NOT_FOUND`, `USER_DISABLED` o `UNKNOWN_USER_ROLE`. Una identidad incompatible con el Payment Attempt responde `ORDER_NOT_FOUND`.

## Orders históricas sin propietario

PostgreSQL exige `owner_user_id NOT NULL`, así que toda Order persistida tiene propietario. Las Orders sin propietario solo existen como fixtures legacy del store In-Memory. Para ellas la política es la siguiente.

- Ningún comprador puede consultarlas ni pagarlas, y responden `ORDER_NOT_FOUND`.
- Nunca se asignan al usuario activo y no se migran ni se eliminan.
- ADMIN puede consultarlas por `GET /api/v2/orders/:orderId` para revisión administrativa o pruebas históricas.
- Nadie puede procesar Payments sobre ellas.
