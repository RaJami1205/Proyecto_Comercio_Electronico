# CiberNova — E-Commerce de Tecnología

CiberNova es una aplicación web de comercio electrónico enfocada en productos de tecnología, computación y electrónica.

El proyecto fue desarrollado como parte del curso de **Comercio Electrónico** y tiene como objetivo ofrecer una experiencia moderna, responsive y orientada a búsqueda mediante una arquitectura separada entre frontend y backend.

La aplicación permite explorar productos reales, realizar búsquedas dinámicas, aplicar filtros, utilizar paginación y consultar información detallada de cada producto.

---

## Características principales

- Catálogo de productos conectado con Algolia.
- Búsqueda dinámica con autocomplete.
- Filtros por categoría, marca y rango de precio.
- Paginación responsive.
- Product Quick View.
- Diseño adaptado para desktop, tablet y mobile.
- Backend dedicado para centralizar la comunicación con Algolia.
- Manejo seguro de variables de entorno y credenciales.

---

## Tecnologías utilizadas

### Frontend

- React
- TypeScript
- Vite
- CSS Modules
- Fetch API

### Backend

- Node.js
- TypeScript
- Express
- Algolia JavaScript API Client
- CORS
- dotenv

### Herramientas de desarrollo

- Git
- GitHub
- npm
- ESLint
- GitHub Actions
- Visual Studio Code

---

## Arquitectura

El proyecto está dividido en dos aplicaciones independientes:

```text
E_Commerce/
├── client/
│   ├── src/
│   │   ├── components/
│   │   ├── hooks/
│   │   ├── pages/
│   │   ├── services/
│   │   ├── styles/
│   │   ├── utils/
│   │   └── assets/
│   └── package.json
│
├── server/
│   ├── src/
│   │   ├── config/
│   │   ├── controllers/
│   │   ├── mappers/
│   │   ├── routes/
│   │   ├── services/
│   │   └── types/
│   └── package.json
│
└── README.md
```

El flujo principal de comunicación es:

```text
React
  ↓
Fetch API
  ↓
Express
  ↓
Algolia
  ↓
Express
  ↓
React
```

El frontend se encarga de la interfaz, estado y experiencia del usuario, mientras que el backend centraliza las consultas hacia Algolia y evita exponer credenciales sensibles en el navegador.

---

## Decisiones principales

### Separación Client / Server

El directorio `client/` contiene la aplicación React ejecutada en el navegador.

El directorio `server/` contiene la API desarrollada con Express y la integración con Algolia.

### Integración con Algolia

React no accede directamente a credenciales privadas de Algolia.

Todas las consultas siguen el flujo:

```text
Client → Server → Algolia
```

Esto permite centralizar:

- búsqueda;
- filtros;
- paginación;
- configuración;
- manejo de errores;
- credenciales.

### Diseño responsive

La cuadrícula principal del catálogo utiliza:

| Vista | Columnas | Productos por página |
|---|---:|---:|
| Desktop | 3 | 9 |
| Tablet | 3 | 6 |
| Mobile | 2 | 6 |

---

## Requisitos previos

Antes de ejecutar el proyecto se debe tener instalado:

- Git
- Node.js
- npm
- Navegador web moderno

Para verificar las instalaciones:

```bash
git --version
node --version
npm --version
```

También se requiere acceso a una aplicación e índice configurados en Algolia.

---

## Clonar el repositorio

```bash
git clone <URL_DEL_REPOSITORIO>
cd E_Commerce
```

Reemplazar `<URL_DEL_REPOSITORIO>` por la URL correspondiente del repositorio en GitHub.

---

## Instalación

El frontend y backend poseen dependencias independientes.

### Frontend

```bash
cd client
npm install
```

### Backend

Desde la raíz del proyecto:

```bash
cd server
npm install
```

---

## Variables de entorno

El proyecto utiliza archivos `.env` independientes para frontend y backend.

Estos archivos no deben publicarse en Git.

### Frontend

Crear el archivo:

```text
client/.env
```

Con la variable:

```env
VITE_API_BASE_URL=http://localhost:3000
```



## Ejecutar el proyecto

El frontend y backend deben ejecutarse en terminales separadas.

### 1. Ejecutar el backend

```bash
cd server
npm run dev
```

El servidor utilizará el puerto configurado mediante la variable `PORT`.

### 2. Ejecutar el frontend

```bash
cd client
npm run dev
```

Vite mostrará la dirección local de la aplicación, normalmente:

```text
http://localhost:5173
```

El flujo de ejecución local será aproximadamente:

```text
Browser
   ↓
React / Vite
   ↓
Express API
   ↓
Algolia
```

---

## Comandos principales

### Client

| Comando | Descripción |
|---|---|
| `npm run dev` | Inicia el servidor de desarrollo |
| `npm run lint` | Ejecuta ESLint |
| `npm run build` | Compila y genera el build |
| `npm run preview` | Visualiza localmente el build |

### Server

| Comando | Descripción |
|---|---|
| `npm run dev` | Inicia el servidor en modo desarrollo |
| `npm run build` | Compila TypeScript |
| `npm start` | Ejecuta el servidor compilado |

---

## Validación antes de integrar cambios

Antes de realizar un commit o Pull Request se recomienda ejecutar las validaciones correspondientes.

### Client

```bash
cd client
npm run lint
npm run build
```

### Server

```bash
cd server
npm run build
```

Los comandos deben finalizar correctamente antes de integrar cambios en las ramas principales.

---

## Flujo Git

El proyecto utiliza el siguiente esquema de ramas:

```text
main
└── dev
    └── feature/*
```

Las nuevas funcionalidades se desarrollan dentro de ramas `feature/*` y posteriormente se integran mediante Pull Requests.

Flujo general:

```text
feature/*
   ↓
dev
   ↓
main
```

---

## Seguridad

Durante el desarrollo se siguen las siguientes prácticas:

- No publicar archivos `.env`.
- No almacenar API Keys privadas en el frontend.
- No incluir secretos directamente en el código fuente.
- Mantener la comunicación con Algolia desde el backend.
- Validar los cambios antes de integrarlos al repositorio.

---

## Estado del proyecto

La primera versión de CiberNova cuenta actualmente con:

- catálogo dinámico;
- búsqueda;
- autocomplete;
- filtros;
- paginación;
- Product Quick View;
- responsive design;
- integración Client–Server–Algolia.

La arquitectura fue desarrollada de forma incremental y permite continuar incorporando nuevas funcionalidades de comercio electrónico en futuras etapas.

---

## Autores

Proyecto desarrollado como parte del curso de **Comercio Electrónico**.

**Tecnológico de Costa Rica — Escuela de Ingeniería en Computación**

---

## Licencia

Proyecto desarrollado con fines académicos.
