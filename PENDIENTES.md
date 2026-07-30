# Pendientes y recomendaciones

Estado al cierre de esta ronda de trabajo. Escrito para que quien retome
—incluido yo mismo— no tenga que redescubrir nada.

---

## 1. Verificar en producción lo que estuvo roto

**Esto primero, antes que cualquier función nueva.**

Dos columnas de la base quedaron acentuadas por error en el commit de tildes y
solo fallaban en PostgreSQL, es decir **solo en producción**:

| Archivo | Estaba | Corregido |
|---|---|---|
| `notificacionesPgService.js` | `n.leída` | `n.leida` |
| `enviosService.js` | `LOWER(i.código)` | `LOWER(i.codigo)` |

La primera está en el `WHERE` de "solo no leídas", que es la consulta que corre
cada 45 segundos para los avisos. Estuvo rota varios días.

**Qué comprobar:** que lleguen las notificaciones y que el buscador de envíos
encuentre por código. Si algo sigue raro, `GET /api/admin/error-log` muestra los
errores que registró el servidor.

---

## 2. Las solicitudes no cargan hasta apretar "Actualizar"

Reportado y **sin resolver**. No quise subir un arreglo sobre una causa no
confirmada.

**Lo que ya se descartó**, para no repetir el camino:

- *No es el service worker*: usa network-first para las llamadas al servidor, así
  que no sirve datos viejos salvo que la petición falle.
- *No es la bandera `isListLoading`* de `solicitudes.js:1847`. Parecía el
  culpable —si queda en `true`, la carga inicial se salta en silencio— pero esa
  misma bandera deshabilita el botón Actualizar. Como Actualizar sí funciona, la
  bandera no está trabada.
- La carga inicial **sí** se llama (`solicitudes.js:3181`).

**Por dónde seguir:** abrir Solicitudes, ver que no carga, y mirar
`GET /api/admin/error-log` en ese momento. Puede además que fuera consecuencia
del bug de `n.leida`; conviene reintentar ahora que está corregido.

---

## 3. El chat al cerrarse

Al cerrar el chat la vista queda mal posicionada y hay que subir a mano. No se
siente un panel que abre y cierra. Ya se corrigió que **baje solo al último
mensaje** al abrirlo, pero el cierre sigue pendiente.

---

## 4. Pantalla para leer el feedback

El feedback se guarda y **ahora avisa** a ADMIN y SUPERVISOR, pero todavía no hay
pantalla para leerlo: solo `GET /api/feedback`. Falta la vista.

---

## 5. Novedades automáticas

Que cada cambio aparezca solo en la pestaña Novedades, redactado corto y como lo
escribiría una persona.

**Advertencia de diseño:** generar ese texto automáticamente desde los commits va
a sonar exactamente a lo que no se quiere. Conviene una plantilla corta por tipo
de evento, escrita a mano una vez, y no texto generado.

---

## 6. Stock por QR

La idea grande. Hoy el portal responde *"cuánto conviene mantener"* pero no
*"cuánto pedir hoy"*, porque **no existe el stock** de los insumos que se
consumen: la tabla `inventario` solo tiene 3 repuestos mecánicos y ninguno de los
productos que la gente pide.

La decisión de fondo no es técnica: **qué representa cada código QR** —la
bandeja, el producto, o el par producto-bandeja—. De eso depende todo el modelo.
Los códigos se pueden generar en el navegador sin servicios pagados.

---

## Cosas que conviene no repetir

**Los reemplazos masivos de texto necesitan verse ejecutando.** El script de
tildes pasó revisión de sintaxis y 54 tests, y aun así rompió dos columnas SQL y
64 atributos HTML. Ninguna de esas fallas se ve leyendo el código: se vieron
abriendo la aplicación y midiendo.

**Un detector de código muerto no ve las clases que se arman en tiempo de
ejecución.** Reportó 69 clases CSS sin uso; varias se construyen con
`item-status-${normalized}` y borrarlas habría dejado los estados sin color.

**Lo que solo falla en PostgreSQL no aparece en local.** Todo lo que toque SQL
conviene revisarlo pensando en que el entorno de desarrollo usa SQLite y no
ejecuta esas rutas.

---

## Estado verificado al cierre

- 100 tests, 0 fallas
- 0 errores de sintaxis (frontend revisado como módulos ES)
- 0 caracteres de control, 0 homoglifos, 0 columnas SQL acentuadas
- `/web`, solicitudes, notificaciones, reportes, dashboard, feedback y equipos
  responden 200; el registro de errores del servidor está vacío
