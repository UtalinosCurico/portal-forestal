# Portal Forestal Maule Norte (Portal FMN)

Aplicacion web para gestion de solicitudes, inventario y trazabilidad operacional por equipo, con RBAC y Power BI embebido.

## Stack

- Backend: Node.js + Express
- Frontend: HTML + CSS + JavaScript (sin frameworks)
- Base de datos:
  - SQLite local para operacion general
  - PostgreSQL opcional como fuente persistente de `usuarios + auth`

## Estructura activa

```text
portal-forestal/
  backend/
    server.js
    database/
      db.js
      init.js
    middleware/
      auth.js
      authorize.js
      roles.js
      errorHandlers.js
    routes/
      test.js
      auth.js
      dashboard.js
      solicitudes.js
      inventario.js
      usuarios.js
      equipos.js
      powerbi.js
    services/
      authService.js
      dashboardService.js
      solicitudesService.js
      inventarioService.js
      usuariosService.js
      equiposService.js
  frontend/
    index.html
    style.css
    app.js
    js/
      dashboard.js
      usuarios.js
      equipos.js
    views/
      dashboard.html
      solicitudes.html
      inventario.html
      equipos.html
      usuarios.html
      powerbi.html
```

## Requisitos

- Node.js 20+ (probado con Node 24)
- npm 10+

## Instalacion

Desde la raiz del proyecto:

```bash
npm install
```

## Ejecutar en local

```bash
npm start
```

Servidor en:

- API: `http://localhost:3000`
- Portal web: `http://localhost:3000/web`

## Usuarios demo

- ADMIN: `admin@forestal.cl / Admin123!`
- SUPERVISOR: `supervisor@forestal.cl / Supervisor123!`
- JEFE_FAENA: `jefe@forestal.cl / Jefe123!`
- OPERADOR: `operador@forestal.cl / Operador123!`

## Despliegue en Vercel

1. Instalar CLI e iniciar sesion:

```bash
npm install -g vercel
vercel login
```

2. Desplegar desde la raiz (`portal-forestal`):

```bash
vercel
```

3. Produccion:

```bash
vercel --prod
```

Notas de despliegue:

- `vercel.json` enruta todo trafico al handler `backend/server.js`.
- El backend sigue sirviendo frontend y API desde el mismo entrypoint.
- En Vercel, SQLite usa `SQLITE_PATH=/tmp/portal_forestal.db` automaticamente (filesystem efimero).
- Para persistencia real en produccion, configurar `DATABASE_URL` a una BD PostgreSQL externa.
- Cuando `DATABASE_URL` existe:
  - `usuarios + auth` pasan a PostgreSQL
  - `solicitudes + mensajes + historial + notificaciones + dashboard de solicitudes` pasan a PostgreSQL
  - SQLite queda como espejo local para mantener compatibilidad con solicitudes/envios
  - el bloqueo de seguridad del modulo `Usuarios` se desactiva automaticamente
- Cuando `DATABASE_URL` no existe en Vercel:
  - el modulo `Usuarios` sigue bloqueado para evitar perdida de cuentas por SQLite efimero

## PostgreSQL para usuarios/auth

Local:

```bash
set DATABASE_URL=postgres://postgres:postgres@localhost:5432/portal_forestal
set PGSSLMODE=disable
npm start
```

Vercel:

```bash
vercel env add DATABASE_URL
vercel env add PGSSLMODE
vercel --prod
```

Valores recomendados:

- `DATABASE_URL`: cadena completa de PostgreSQL
- `PGSSLMODE`: `require` para proveedores cloud o `disable` en localhost

## Modulos implementados

- Login con JWT
- Dashboard interno con Chart.js
  - Solicitudes por estado
  - Solicitudes por equipo
  - Solicitudes ultimos 7 dias
  - Tabla de solicitudes enviadas
- Solicitudes con trazabilidad y flujo de estados
- Inventario global y vista por equipo
- Equipos y stock en faena (`equipo_stock`)
- Usuarios (CRUD completo para ADMIN, solo lectura para SUPERVISOR)
- Power BI embebido (solo ADMIN/SUPERVISOR)

## Endpoints principales

Publicos:

- `GET /`
- `GET /api/test`
- `POST /api/auth/login`

Protegidos:

- `GET /api/auth/me`
- `GET /api/dashboard`
- `GET /api/dashboard/metrics`
- `GET /api/solicitudes`
- `POST /api/solicitudes`
- `PUT /api/solicitudes/:id`
- `GET /api/inventario`
- `POST /api/inventario`
- `PUT /api/inventario/:id`
- `GET /api/usuarios`
- `POST /api/usuarios`
- `PUT /api/usuarios/:id`
- `GET /api/equipos`
- `GET /api/equipos/stock`
- `POST /api/equipos`
- `PUT /api/equipos/:id`
- `GET /api/powerbi`

## Reglas clave de permisos

- ADMIN: acceso total
- SUPERVISOR: vision global operacional, usuarios solo lectura
- JEFE_FAENA: visibilidad solo de su equipo
- OPERADOR: visibilidad solo de su equipo
- Power BI: solo ADMIN y SUPERVISOR

## Pruebas rapidas

1. Verificar API base:

```bash
curl http://localhost:3000/api/test
```

2. Login:

```bash
curl -X POST http://localhost:3000/api/auth/login ^
  -H "Content-Type: application/json" ^
  -d "{\"email\":\"admin@forestal.cl\",\"password\":\"Admin123!\"}"
```

3. Con token bearer, probar:

- `GET /api/dashboard`
- `GET /api/usuarios`
- `GET /api/equipos/stock`
- `GET /api/powerbi`

## Notas de compatibilidad

- El runtime activo usa `backend/server.js` y `backend/routes/*.js`.
- Archivos legados (`*.routes.js`, servicios PG antiguos) no se montan.
- La migracion SQLite es idempotente y no borra datos existentes.
