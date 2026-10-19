// Cada empresa tiene su propio informe de Power BI, y el portal muestra el que
// corresponde a la empresa activa: al cambiar de empresa en el menu, cambia el
// tablero. Son enlaces de "publicar en la web", asi que quien tiene el enlace
// ve el informe; por eso el portal entrega solo el de la empresa en la que se
// esta trabajando y nunca el de la otra.
//
// Para cambiar un informe basta con reemplazar su `src` aqui.

const { EMPRESAS } = require("./empresas");

const POWERBI_POR_EMPRESA = Object.freeze({
  [EMPRESAS.MAULE_NORTE.id]: Object.freeze({
    title: "Indicadores Maule Norte",
    src:
      "https://app.powerbi.com/view?r=eyJrIjoiOGZhMjM5YjktMjZkOS00OTIxLTllNTAtZjc5ZmFiMWI0YjY4IiwidCI6IjgwMmRkMjdiLWY2NDYtNGY4NC05NDBiLTkyMzlmNDE5NDY2YSIsImMiOjR9",
  }),
  [EMPRESAS.FOREST_SAINT.id]: Object.freeze({
    title: "Indicadores Forest Saint",
    src:
      "https://app.powerbi.com/view?r=eyJrIjoiZTY2MjFhODAtYWIwMy00YTQ1LWI0OTktNjdkNWRlY2VmZTBiIiwidCI6IjgwMmRkMjdiLWY2NDYtNGY4NC05NDBiLTkyMzlmNDE5NDY2YSIsImMiOjR9&embedImagePlaceholder=true&pageName=b70b04c0200a2a75d050",
  }),
});

const POWERBI_BASE = Object.freeze({
  width: 600,
  height: 486,
  allowFullScreen: true,
});

/** Informe de una empresa, o null si todavia no tiene uno cargado. */
function getPowerbiPorEmpresa(empresaId) {
  const informe = POWERBI_POR_EMPRESA[empresaId];
  return informe ? { ...POWERBI_BASE, ...informe } : null;
}

module.exports = {
  POWERBI_POR_EMPRESA,
  getPowerbiPorEmpresa,
};
