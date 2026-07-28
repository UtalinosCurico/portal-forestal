// Los trabajadores escriben el nombre del producto a mano, asi que "Papel
// Higienico", "papel higiénico" y "PAPEL  HIGIENICO" llegan como tres textos
// distintos. Sin normalizar, cualquier total por producto queda inservible.
//
// La normalizacion de aca es deliberadamente conservadora: solo unifica cosas
// que son con certeza el mismo texto (mayusculas, tildes, espacios, puntuacion
// suelta). NO adivina que "papel hig." es "papel higienico": unir por parecido
// puede sumar productos distintos y llevar a decidir mal un stock. Para esos
// casos se detectan candidatos y se le muestran a la persona, que decide.

const UNIDAD_SINONIMOS = new Map([
  ["un", "unidad"],
  ["uni", "unidad"],
  ["und", "unidad"],
  ["unid", "unidad"],
  ["unidades", "unidad"],
  ["u", "unidad"],
  ["pza", "unidad"],
  ["pzas", "unidad"],
  ["kilos", "kg"],
  ["kilo", "kg"],
  ["kgs", "kg"],
  ["litros", "lt"],
  ["litro", "lt"],
  ["lts", "lt"],
  ["l", "lt"],
  ["cajas", "caja"],
  ["cjs", "caja"],
  ["rollos", "rollo"],
  ["pares", "par"],
  ["paquetes", "paquete"],
  ["paq", "paquete"],
  ["bolsas", "bolsa"],
  ["metros", "mt"],
  ["metro", "mt"],
  ["mts", "mt"],
]);

function stripAccents(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

/**
 * Clave de agrupacion. Dos nombres con la misma clave son, con alta confianza,
 * el mismo producto escrito distinto.
 */
function buildProductoKey(nombre) {
  return stripAccents(nombre)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ") // puntuacion suelta: "papel-higienico" -> "papel higienico"
    .replace(/\s+/g, " ")
    .trim();
}

/** Normaliza la unidad de medida, que tambien viene escrita a mano. */
function normalizeUnidad(unidad) {
  const base = buildProductoKey(unidad);
  if (!base) {
    return "";
  }
  return UNIDAD_SINONIMOS.get(base) || base;
}

/**
 * Nombre que se muestra en el reporte. Entre todas las variantes escritas se
 * elige la mas frecuente; a igual frecuencia, la mas larga (suele ser la mas
 * descriptiva: "guantes de seguridad" antes que "guantes").
 */
function pickNombreVisible(variantes = []) {
  let elegido = "";
  let mejorConteo = -1;

  for (const { nombre, conteo } of variantes) {
    const texto = String(nombre || "").trim();
    if (!texto) {
      continue;
    }
    if (
      conteo > mejorConteo ||
      (conteo === mejorConteo && texto.length > elegido.length)
    ) {
      elegido = texto;
      mejorConteo = conteo;
    }
  }

  return elegido;
}

/** Distancia de Levenshtein acotada, para sugerir posibles duplicados. */
function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  let fila = Array.from({ length: b.length + 1 }, (_, i) => i);

  for (let i = 1; i <= a.length; i += 1) {
    const siguiente = [i];
    for (let j = 1; j <= b.length; j += 1) {
      const costo = a[i - 1] === b[j - 1] ? 0 : 1;
      siguiente[j] = Math.min(
        fila[j] + 1,
        siguiente[j - 1] + 1,
        fila[j - 1] + costo
      );
    }
    fila = siguiente;
  }

  return fila[b.length];
}

/** Similitud 0..1 entre dos claves ya normalizadas. */
function similitud(a, b) {
  const largoMayor = Math.max(a.length, b.length);
  if (!largoMayor) return 0;
  return 1 - levenshtein(a, b) / largoMayor;
}

/**
 * Busca pares de claves distintas que probablemente sean el mismo producto,
 * para ofrecerlos como sugerencia. Nunca los une por su cuenta.
 *
 * Criterios: muy parecidos en texto, o uno es prefijo del otro (el caso tipico
 * de la abreviatura: "papel hig" dentro de "papel higienico").
 */
function soloLetras(clave) {
  return clave.replace(/[0-9]/g, "").replace(/\s+/g, " ").trim();
}

function tieneDigitos(clave) {
  return /[0-9]/.test(clave);
}

/**
 * Dos nombres que solo se diferencian en los numeros casi nunca son un error de
 * tipeo: los numeros suelen ser la medida o el modelo. "cadena 18" y "cadena 20"
 * son productos distintos, y sugerir unirlos llevaria a un stock equivocado.
 */
function difierenSoloEnNumeros(a, b) {
  if (!tieneDigitos(a) && !tieneDigitos(b)) {
    return false;
  }
  return soloLetras(a) === soloLetras(b);
}

function detectarPosiblesDuplicados(claves = [], { umbral = 0.82, maximo = 25 } = {}) {
  const sugerencias = [];
  const lista = [...claves].filter(Boolean);

  for (let i = 0; i < lista.length; i += 1) {
    for (let j = i + 1; j < lista.length; j += 1) {
      const a = lista[i];
      const b = lista[j];

      if (difierenSoloEnNumeros(a, b)) {
        continue;
      }

      const esPrefijo =
        (a.startsWith(b) || b.startsWith(a)) && Math.min(a.length, b.length) >= 4;
      const parecido = similitud(a, b);

      if (esPrefijo || parecido >= umbral) {
        sugerencias.push({
          claves: [a, b],
          similitud: Number(parecido.toFixed(2)),
          motivo: esPrefijo ? "abreviatura" : "escritura similar",
        });
      }
    }
  }

  return sugerencias
    .sort((x, y) => y.similitud - x.similitud)
    .slice(0, maximo);
}

module.exports = {
  buildProductoKey,
  normalizeUnidad,
  pickNombreVisible,
  detectarPosiblesDuplicados,
  similitud,
};
