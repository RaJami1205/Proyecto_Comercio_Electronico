# React + TypeScript + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend updating the configuration to enable type-aware lint rules:

```js
export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...

      // Remove tseslint.configs.recommended and replace with this
      tseslint.configs.recommendedTypeChecked,
      // Alternatively, use this for stricter rules
      tseslint.configs.strictTypeChecked,
      // Optionally, add this for stylistic rules
      tseslint.configs.stylisticTypeChecked,

      // Other configs...
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])

```

You can also install [eslint-plugin-react-x](https://npmx.dev/package/eslint-plugin-react-x) and [eslint-plugin-react-dom](https://npmx.dev/package/eslint-plugin-react-dom) for React-specific lint rules:

```js
// eslint.config.js
import reactX from 'eslint-plugin-react-x'
import reactDom from 'eslint-plugin-react-dom'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...
      // Enable lint rules for React
      reactX.configs['recommended-typescript'],
      // Enable lint rules for React DOM
      reactDom.configs.recommended,
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])

```

## Revisión y creación de órdenes

El Checkout presenta Comprador, Entrega, Revisión y Pago. La revisión deriva importes previos con cartCalculations. Confirmar envía únicamente buyer, delivery, productId/quantity e idempotencyKey a POST /api/orders mediante orderApi. Configura VITE_API_BASE_URL con la URL del backend, como para el catálogo.

La Order recibida reemplaza el resumen previo y se conserva en el estado local del Checkout. Pago muestra la orden pendiente sin procesar cobros ni limpiar el carrito. Un error controlado permite corregir datos. Ante un fallo técnico, el reintento conserva clave y payload; los datos del intento permanecen visibles y su edición se bloquea hasta resolverlo. El botón y la navegación se bloquean durante el envío.

Verificación: npm run lint y npm run build.

Pruebas focalizadas del contrato HTTP y errores: node --test tests/orderApi.test.mjs.

## Limpieza del carrito después de aprobación

CartContext expone clearCart() y el reducer admite CLEAR_CART. El estado vacío se guarda mediante cartStorage, por lo que el carrito continúa vacío tras recargar y se sincroniza con otras pestañas como los cambios existentes.

Checkout observa su Order mediante useClearCartAfterPayment(order). Limpia solamente cuando el snapshot recibido del servidor contiene orderStatus = CONFIRMED y paymentStatus = APPROVED. PENDING, DECLINED, ERROR y fallos técnicos conservan el carrito. Un mismo OrderId limpia una sola vez durante ese Checkout: un replay no elimina productos añadidos posteriormente. La Order y su resumen permanecen disponibles aunque el carrito quede vacío.

Integración para el ticket de UI de pagos: al recibir PaymentResult, actualizar el estado existente mediante setOrder(paymentResult.order). Esto activa la limpieza automáticamente; no hace falta invocar clearCart() desde el componente de pagos. Esta implementación no incluye Payment UI ni solicita pagos.

Pruebas: node --test tests/*.test.mjs.

## Términos y condiciones (CN-41)

La ruta hash #terms publica TermsPage con PolicyLayout y PolicySection. El Footer conserva su navegación existente, Browser Back y los enlaces en otra pestaña desde Checkout; la ruta funciona con la base de GitHub Pages.

La fuente única es src/content/terms.ts: termsPolicy agrupa versión, fecha de publicación, título, introducción y secciones. Versión inicial: 2026-10-lab4-v1 (2026-10-21). Todo cambio comercial posterior debe actualizar la versión junto con el contenido. TermsContent presenta secciones y metadatos sin navegación propia; el futuro Dialog puede reutilizarlo y tomar título e introducción del mismo módulo.

No se agregan consentimiento, Dialog, campos de aceptación, cambios de contratos ni lógica de Checkout o Backend. La política describe el alcance académico y el Sandbox, sin pagos reales ni entregas físicas.

Verificación: npm run lint, npm run build y node --test tests/*.test.mjs. Las pruebas de navegación cubren la página real, sus cuatro secciones, versión, asociaciones accesibles, Footer, historial y base de despliegue.

## Política de Devoluciones (CN-42)

La ruta #returns-policy publica ReturnsPolicyPage reutilizando PolicyLayout, PolicySection y los estilos compartidos. Footer, History API, foco inicial y enlaces de Checkout conservan su comportamiento.

La fuente src/content/returnsPolicy.ts centraliza el plazo voluntaryReturnWindowDays (15 días naturales desde la entrega hipotética), requestSummary y las cuatro secciones. La futura FAQ puede importar esos valores sin copiar la política completa. El día siguiente a la entrega es el día 1 y se incluyen fines de semana y feriados. El contenido distingue devoluciones voluntarias de reclamos por defectos y reconoce las garantías o derechos aplicables.

El procedimiento es informativo: no hay canal operativo, formularios, reembolsos ni seguimiento logístico. La Order y el Sandbox siguen siendo demostrativos; esta página no modifica contratos ni estados transaccionales. Envíos, Privacidad y FAQ siguen como destinos en preparación; los términos publicados mantienen el mismo alcance académico.

Verificación: npm run lint, npm run build y node --test tests/*.test.mjs. Las pruebas verifican contenido, secciones, plazo, PolicyLayout, Footer, navegación, asociaciones accesibles y ausencia de formularios.
## Sesión simulada (CN-53)

`CartProvider → SessionProvider → App` mantiene la identidad validada únicamente en memoria.
`sessionApi` consume `GET /api/users` y `POST /api/session/resolve`; valida respuestas y no envía roles,
Company ni headers de autorización como autoridad. No hay passwords, tokens, cookies o restauración automática.

El catálogo sigue público y a precios Retail. Checkout se habilita temporalmente solo para B2C resuelto;
B2B y ADMIN pueden seleccionarse, pero no comprar. Estas guardas Client no sustituyen RBAC Server.

Login, cambio y Logout exigen descarte explícito si el Cart contiene productos. Un cambio durante
la resolución o el consentimiento exige revisar nuevamente; cancelar o recibir un error conserva la sesión y el Cart.
La sesión cambia en un único punto de commit. CN-72 publica `SESSION_STARTED` después del commit de React,
mediante una transición explícita e idempotente, sin tracking provisional.
Recent Searches y Search se reinician en memoria sin desmontar el catálogo completo.

La clave `cibernova:cart:v1` sigue compartida: los eventos externos se marcan como conflicto y no hidratan
productos automáticamente. Checkout queda bloqueado hasta un descarte confirmado. Esto no ofrece ownership,
aislamiento del almacenamiento entre pestañas ni migración por usuario; corresponden a CN-60.

Las operaciones activas o inciertas impiden navegación y cambios de identidad. Retry conserva Order,
payload y claves. Los resultados controlados DECLINED/ERROR permiten Retry y salida segura.
El aviso del navegador ante reload es preventivo: una recarga forzada pierde Session y referencias
transaccionales en memoria, sin recuperación durable. Cart restaurado vuelve a tener propietario no verificado.

Validación: `npm run lint`, `npm run build`, `node --test tests/*.test.mjs` desde `client/`.

## Analytics Core (CN-72)

Los seis eventos son `SESSION_STARTED`, `SEARCH_PERFORMED`, `PRODUCT_VIEWED`, `CART_ITEM_ADDED`,
`CHECKOUT_STARTED` y `PURCHASE_COMPLETED`. Los emisores entregan metadata discriminada; `trackEvent`
valida y crea un envelope con `eventId`, `type`, `occurredAt`, `userId` (`null` para anónimo) y `schemaVersion: 2`.
Search se registra al ejecutar la consulta del catálogo por un cambio efectivo de query; autocomplete,
Enter repetido sin cambio, filtros, sorting, pagination y replay de Effects no crean búsquedas adicionales.
El texto de búsqueda y Recent Searches continúan únicamente en memoria.

Se guarda un snapshot en `cibernova:analytics:v2:user:<userId codificado>` o `cibernova:analytics:v2:anonymous`.
Contiene los últimos 500 eventos, contadores acumulativos, hasta diez IDs recientes y todos los Order IDs
de compras contadas. Nunca se recalculan acumulados desde el log truncado ni se eliminan referencias
de compras mientras esas compras sigan contadas. Cada compra requiere el resultado autoritativo
`PAYMENT_APPROVED` con Order `CONFIRMED`/`APPROVED`; se deduplica por Order ID y usuario.
No se guardan queries, Buyer/Delivery PII, productos completos ni datos de tarjeta.

La lectura valida versión, owner, campos exactos, fechas, IDs, metadata y coherencia de contadores/referencias.
Los snapshots v1 válidos se proyectan a v2 conservando acumulados y referencias, con IDs de eventos
legacy deterministas; la primera escritura v2 se hace bajo el mismo lock. La clave v1 queda intacta.
Datos corruptos o incompatibles tampoco se borran ni sobrescriben: ese scope continúa en memoria.

Las escrituras v2 usan un Web Lock exclusivo por scope para leer el último snapshot, aplicar el buffer
local y persistirlo. Esto evita que dos pestañas cooperantes pierdan acumulados o cuenten dos veces
el mismo Order ID. Los selectors y notificaciones usados por CN-73 conservan sus interfaces síncronas;
las métricas se actualizan en memoria inmediatamente. `flushAnalytics()` permite esperar las escrituras
programadas en pruebas, sin bloquear operaciones comerciales.

Si Web Locks no está disponible, el lock falla o localStorage está bloqueado/sin quota, Analytics continúa
en memoria y evita escrituras sin coordinación. El buffer se reintenta ante actividad posterior cuando
la capacidad vuelve a estar disponible. La actividad aún no persistida puede perderse al cerrar/recargar;
las referencias de compras y el buffer pueden crecer con el uso. Es historia local del navegador, no
reportería global ni fuente de verdad de Orders. Borrar browser storage pierde las métricas locales.

## User History & Personalization (CN-73)

El catálogo ofrece dos experiencias basadas en actividad real: Vistos recientemente, alimentado por
`PRODUCT_VIEWED`, y Recent Searches, alimentado por búsquedas confirmadas y conservado solo en memoria.
Una transición cancelada conserva Recent Searches; un cambio efectivo de identidad, Logout o reload lo reinicia.

Vistos recientemente usa los diez IDs ordenados del scope Analytics actual y resuelve sus datos vigentes
mediante `GET /api/products?ids=...` (parámetros repetidos, máximo diez). IDs ausentes conservan Listing;
IDs presentes pero vacíos/inválidos responden 400. El Server conserva orden y dedup y omite productos inexistentes.
El Client valida la respuesta desde `unknown`, proyecta `Product`/`ProductSpecification`, rechaza IDs ajenos
y conserva el orden solicitado. `Product.category` refleja la etiqueta string del mapper Server, incluyendo
categorías como Almacenamiento y Componentes, sin traducir ni modificar sus valores comerciales.

Sin historial, la sección no ocupa espacio. Con IDs, distingue Loading, Empty por productos eliminados,
Error y Success. Reintentar/Actualizar permiten recuperar datos vigentes; durante carga o error solo se
conservan productos ya válidos del mismo owner y todavía incluidos en el historial, con un aviso explícito.
Los precios/stock resueltos viven únicamente en React y nunca sustituyen la autoridad de Checkout/Server.

Cada montaje/cambio de owner resuelve el historial; las notificaciones comparan los IDs ordenados y
solo vuelven a consultar si cambian. Storage de otros scopes se ignora. Actualizar fuerza una consulta
comercial nueva, sin caché persistente. Las respuestas antiguas se descartan al cambiar owner o solicitud.

Las pruebas usan componentes/servicios reales con storage, fetch y catálogo aislados; los tests HTTP del
controller usan Express y el mapper real en loopback. No prueban Algolia ni despliegues remotos.
