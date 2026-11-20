# Herramientas de QA del CN-69

Estas herramientas reproducen el E2E en navegador del reporte de QA. No forman parte de la aplicación ni de sus dependencias, y nunca deben apuntar a producción.

- `stack.mjs` levanta el Server real con PostgreSQL aislado, sustituye Algolia por el catálogo ficticio de `server/tests/helpers/fakeAlgoliaCatalog.mjs` y sirve el Client compilado.
- `ui-e2e.mjs` recorre los escenarios UI-01 a UI-10 en Chrome y guarda capturas en Desktop, Tablet y Mobile.

## Requisitos

- PostgreSQL local con la base efímera `cibernova_test`, las tres migraciones y el rol `cibernova_app`, igual que el job de GitHub Actions.
- Google Chrome instalado. Si no está en `/usr/bin/google-chrome`, indicar la ruta con `CHROME_PATH`.
- `npm ci` y `npm run build` ya ejecutados en `server` y `client`.

## Pasos

Desde la raíz del repositorio.

```bash
# 1. Client apuntando a la API local, compilado fuera del repo
cd client
VITE_API_BASE_URL=http://127.0.0.1:3001 npx vite build --outDir /tmp/cibernova-qa-client --emptyOutDir
cd ..

# 2. Dependencia del recorrido, sin modificar package.json del proyecto
cd docs/qa/herramientas
npm install --no-save puppeteer-core@23

# 3. Stack local (dejarlo corriendo en otra terminal)
node stack.mjs

# 4. Recorridos
node ui-e2e.mjs b2c
node ui-e2e.mjs b2b
# detener stack.mjs, volver a iniciarlo y luego
node ui-e2e.mjs restart
```

Los resultados quedan en `ui-results.json` y las capturas en `capturas/`. Ambos están en el `.gitignore` de esta carpeta. En Windows la ruta del paso 1 puede ser cualquier carpeta temporal, indicada también con `QA_CLIENT_DIST` al iniciar `stack.mjs`.
