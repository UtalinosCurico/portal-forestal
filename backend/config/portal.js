// El portal lo comparten Maule Norte y Forest Saint: son dos empresas distintas
// que entran por el mismo login. Por eso el producto no lleva el nombre de
// ninguna de las dos -antes se llamaba "Portal FMN"-, sino lo que hace.
//
// La identidad de cada empresa se muestra por dentro: el color, el logo de la
// barra lateral y el selector de empresa. Ver backend/config/empresas.js.

const NOMBRE_PORTAL = "Portal de Solicitudes";
const DESCRIPCION_PORTAL =
  "Solicitudes operativas, seguimiento y trazabilidad para equipos forestales.";

module.exports = {
  NOMBRE_PORTAL,
  DESCRIPCION_PORTAL,
};
