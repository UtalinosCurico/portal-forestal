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

## Limpieza de duplicados historicos

El backend ya evita nuevos duplicados con `client_request_id`. Para limpiar solicitudes
historicas duplicadas en PostgreSQL existe un script seguro con modo preview y backup:

```bash
npm run dedupe:preview
```

Para aplicar la consolidacion real:

```bash
npm run dedupe:apply
```

Notas:

- El script toma `DATABASE_URL` desde el entorno o desde `.env.production.real`,
  `.env.production`, `.env` o `backend/.env`.
- Antes de modificar datos crea un respaldo JSON en `backups/solicitudes-dedupe-<timestamp>/`.
- Se puede ajustar la ventana de deteccion, por ejemplo:

```bash
node backend/scripts/dedupe-solicitudes.js --window-minutes 15
```

Para el bug historico de arrastre, donde una solicitud nueva copiaba todos los items
de la anterior y solo agregaba los nuevos, existe un segundo script:

```bash
npm run dedupe:progressive:preview
```

Aplicacion real:

```bash
npm run dedupe:progressive:apply
```

Notas:

- Conserva la solicitud mas completa del grupo y fusiona progreso, historial, mensajes
  y notificaciones desde las solicitudes arrastradas.
- Antes de aplicar crea un respaldo JSON en `backups/solicitudes-progressive-dedupe-<timestamp>/`.
- Se puede ajustar la ventana historica, por ejemplo:

```bash
node backend/scripts/dedupe-progressive-solicitudes.js --window-hours 72
```

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
- Reportes de consumo por producto (ADMIN/SUPERVISOR/JEFE_FAENA)
- Asistente PumAI con acceso a los datos del portal
- Power BI embebido (solo ADMIN/SUPERVISOR)

### Asistente PumAI

Usa la SDK oficial de Anthropic (`@anthropic-ai/sdk`) con tool use: el modelo
decide que consultar y responde con los datos reales del portal. Permite
preguntas como "cuanto papel higienico necesito" o "que hay pendiente" sin que
la persona tenga que ir a buscarlo.

Requiere `ANTHROPIC_API_KEY`. El modelo se elige con `ANTHROPIC_MODEL`
(por defecto `claude-opus-4-8`); apuntar a uno mas chico baja el costo a cambio
de peores respuestas.

Tres herramientas, todas de **solo lectura**: `consultar_consumo`,
`buscar_solicitudes` y `listar_equipos` (`backend/services/aiToolsService.js`).

Dos decisiones de seguridad deliberadas:

- **El modelo no tiene acceso SQL.** Solo puede llamar a esas tres consultas
  acotadas, que a su vez llaman a los mismos servicios que usa la interfaz.
- **Los permisos se heredan.** Cada herramienta recibe el usuario del token, no
  uno que el modelo pueda elegir: un JEFE_FAENA sigue viendo solo su equipo
  aunque pida otro explicitamente. Hay tests que lo verifican en
  `backend/tests/ai.test.js`.

El asistente no puede crear ni modificar solicitudes.

### Reportes de consumo

Responde cuanto se pidio de cada producto en un periodo, para definir stock
minimo y maximo. Incluye comparacion mes a mes, desglose por equipo y descarga
en CSV.

Como el nombre del producto lo escribe cada persona a mano, `backend/utils/productoKey.js`
agrupa las escrituras que son con certeza lo mismo (mayusculas, tildes, espacios,
puntuacion): `Papel Higienico`, `papel higiénico` y `PAPEL  HIGIENICO` suman juntas.

Lo que **no** hace es unir por parecido: sumar productos distintos llevaria a
decidir mal un stock. Los nombres sospechosos de ser el mismo se muestran aparte
como sugerencia para que una persona decida. Dos nombres que solo difieren en los
numeros nunca se sugieren, porque el numero suele ser la medida (`cadena 18` y
`cadena 20` son productos distintos).

#### Unificar productos a mano

Cuando la normalizacion automatica no alcanza (`papel hig.` y `papel higienico`,
o un nombre propio de faena), ADMIN o SUPERVISOR pueden declarar que dos nombres
son el mismo producto y elegir con cual queda. La equivalencia se guarda en la
tabla `producto_alias` y **se aplica tambien a lo que se escriba despues**: si un
trabajador vuelve a escribirlo mal, ya se cuenta en el lugar correcto sin que
nadie intervenga. La decision se toma una vez.

Se llega por dos caminos, con la misma ventana:

- desde una sugerencia, con el par ya elegido
- con el boton **Unificar productos**, eligiendo dos cualquiera de la lista

El segundo camino existe porque hay equivalencias que ningun algoritmo puede
deducir: `papel confort` y `papel higienico` no se parecen en el texto, pero en
la faena son lo mismo. Eso solo lo sabe una persona.

Se puede deshacer en cualquier momento desde el panel "Productos unificados": no
se modifica ninguna solicitud, solo la forma de agrupar al calcular el reporte.

Las cadenas se aplanan al guardar (si `A` apunta a `B` y luego se une `C` a `A`,
`C` queda apuntando a `B`), y se rechazan las referencias circulares.

El stock sugerido sale del historial: el minimo es el consumo de un mes promedio
y el maximo es el mes de mayor consumo mas un 50% de holgura. Con un solo mes de
datos la vista avisa que la sugerencia es referencial.

#### Renombrar productos

El nombre automatico (la escritura mas repetida) no siempre alcanza — "PAPEL
CONF. D/H 30MTS" repetido veinte veces sigue siendo ilegible. Desde el reporte
se puede renombrar un producto a mano (boton junto al nombre en la pestaña
Detalle); ese nombre pasa a usarse en el reporte, el Excel y el asistente. Se
puede volver al automatico en cualquier momento. Requiere ADMIN o SUPERVISOR.

#### Pedido por pedido

Al abrir un producto en Detalle, "Ver cada pedido" trae el detalle de cada
pedido individual: fecha, cantidad, equipo, quien lo pidio, y el numero de
solicitud. Se carga aparte (no viaja dentro del reporte general) para no
engordar la respuesta con algo que solo hace falta al mirar un producto puntual.

#### Avisos automaticos de pedidos inusuales

Cuando se crea una solicitud (o se agrega un producto a una existente) con una
cantidad muy por encima de lo tipico para ese producto, ADMIN y SUPERVISOR
reciben una notificacion automatica sin tener que entrar a Reportes a buscarla.
Usa el mismo criterio del reporte (backend/utils/estadistica.js), asi que "esto
es raro" significa lo mismo en todas partes. Con menos de 5 pedidos previos de
ese producto no hay base para decidir, y no avisa.

Ver tambien la pestaña Analisis del reporte de consumo: co-ocurrencia de
productos, comparacion entre equipos y estacionalidad (backend/utils/analisis.js).

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
- `GET /api/reportes/consumo`
- `GET /api/reportes/consumo/detalle`
- `GET /api/reportes/alias`
- `POST /api/reportes/alias`
- `DELETE /api/reportes/alias/:id`
- `GET /api/reportes/nombres`
- `POST /api/reportes/nombres`
- `DELETE /api/reportes/nombres/:id`
- `POST /api/auth/refresh`
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
