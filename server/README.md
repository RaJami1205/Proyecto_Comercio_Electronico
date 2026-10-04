# CiberNova — Seed de Algolia (CN-20)

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
