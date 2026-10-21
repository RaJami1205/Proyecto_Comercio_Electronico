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
