// Un solo criterio para saber donde corre el backend. Vercel define VERCEL en
// cada despliegue (tambien mientras atiende requests); fuera de Vercel manda
// NODE_ENV. El secreto JWT, los avisos del arranque y la lectura de la IP del
// cliente tienen que usar exactamente la misma regla.

function esVercel() {
  return Boolean(process.env.VERCEL);
}

function esProduccion() {
  return esVercel() || process.env.NODE_ENV === "production";
}

module.exports = {
  esVercel,
  esProduccion,
};
