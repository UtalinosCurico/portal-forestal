// Chequeos que atrapan errores que ya nos pasaron, para que no vuelvan.
//
// Ninguno de estos los detecta `node --check` ni los tests normales: son
// validos sintacticamente y solo fallan al ejecutar, o peor, solo en
// produccion. Cada uno viene de un bug real de este proyecto.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const RAIZ = path.join(__dirname, "..", "..");
const EXCLUIR = new Set(["node_modules", ".git", "database", "uploads", "dist", "build"]);

function archivosDeCodigo(dir, salida = []) {
  for (const nombre of fs.readdirSync(dir)) {
    if (EXCLUIR.has(nombre)) continue;
    const p = path.join(dir, nombre);
    if (fs.statSync(p).isDirectory()) archivosDeCodigo(p, salida);
    else if (/\.(js|html|css)$/.test(nombre)) salida.push(p);
  }
  return salida;
}

const ARCHIVOS = [
  ...archivosDeCodigo(path.join(RAIZ, "backend")),
  ...archivosDeCodigo(path.join(RAIZ, "frontend")),
];

// Los propios tests quedan fuera de los chequeos de contenido: este archivo
// cita `n.leída` y el rango cirilico como ejemplos, y se marcaria a si mismo.
const CODIGO_DE_LA_APP = ARCHIVOS.filter(
  (f) => !f.includes(`${path.sep}tests${path.sep}`)
);

// ── 1. Caracteres de control invisibles ────────────────────────────────────
// Un script de reemplazo masivo dejo 64 marcadores de control dentro de
// atributos HTML. Resultado: data-id="", src="" y class="" vacios, o sea
// botones que no hacian nada e imagenes que no cargaban. No se ven leyendo el
// codigo, y grep trata el archivo como binario y no encuentra nada adentro.
test("ningun archivo tiene caracteres de control invisibles", () => {
  const sucios = [];

  for (const archivo of CODIGO_DE_LA_APP) {
    const texto = fs.readFileSync(archivo, "utf8");
    // Se permiten tabulacion, salto de linea y retorno de carro.
    const control = texto.match(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g);
    if (control) {
      sucios.push(`${path.relative(RAIZ, archivo)} (${control.length})`);
    }
  }

  assert.deepEqual(sucios, [], `archivos con caracteres de control:\n  ${sucios.join("\n  ")}`);
});

// ── 2. Homoglifos: letras que se ven latinas y no lo son ───────────────────
// Habia una "a" cirilica (U+0430) infiltrada en el codigo. Se ve identica a la
// latina y ninguna busqueda la encuentra. En un comentario es inofensiva; en
// un nombre de variable o una comparacion, el error es imposible de ver.
test("no hay letras cirilicas disfrazadas de latinas", () => {
  const sucios = [];

  for (const archivo of CODIGO_DE_LA_APP) {
    const lineas = fs.readFileSync(archivo, "utf8").split("\n");
    lineas.forEach((linea, i) => {
      if (/[\u0400-\u04ff]/.test(linea)) {
        sucios.push(`${path.relative(RAIZ, archivo)}:${i + 1}`);
      }
    });
  }

  assert.deepEqual(sucios, [], `lineas con caracteres cirilicos:\n  ${sucios.join("\n  ")}`);
});

// ── 2b. Marcas combinantes sueltas ─────────────────────────────────────────
// Las tildes del castellano en el codigo van precompuestas (a con tilde es un
// solo caracter). Una marca combinante suelta (U+0300 a U+036F) es casi siempre
// un accidente: paso al escribir una expresion regular para quitar tildes, que
// quedo con los caracteres reales en vez de la secuencia de escape. Funciona,
// pero es invisible y nadie la puede revisar a ojo.
test("no hay marcas combinantes sueltas en el codigo", () => {
  const sucios = [];
  for (const archivo of CODIGO_DE_LA_APP) {
    const lineas = fs.readFileSync(archivo, "utf8").split("\n");
    lineas.forEach((linea, i) => {
      if (/[\u0300-\u036f]/.test(linea)) {
        sucios.push(`${path.relative(RAIZ, archivo)}:${i + 1}`);
      }
    });
  }
  assert.deepEqual(sucios, [], `lineas con marcas combinantes sueltas:\n  ${sucios.join("\n  ")}`);
});

// ── 3. Nombres de columna acentuados dentro de SQL ─────────────────────────
// El caso mas caro de todos: `n.leída` y `LOWER(i.código)`. Las columnas de la
// base no llevan tilde. Como el entorno local usa SQLite y esas rutas solo
// corren en PostgreSQL, fallaban UNICAMENTE en produccion, y la de
// notificaciones estaba en la consulta que corre cada 45 segundos.
const COLUMNAS_SIN_TILDE = [
  "leida", "descripcion", "direccion", "codigo", "numero", "periodo", "accion",
  "revision", "version", "sesion", "opcion", "razon", "titulo", "ubicacion",
  "telefono", "categoria", "maximo", "minimo", "recepcion", "gestion",
  "notificacion", "creacion", "edicion", "unico", "dias",
];

const TILDES = { a: "á", e: "é", i: "í", o: "ó", u: "ú", n: "ñ" };
const VARIANTES_ACENTUADAS = new Set();
for (const columna of COLUMNAS_SIN_TILDE) {
  for (let i = 0; i < columna.length; i += 1) {
    const acentuada = TILDES[columna[i]];
    if (acentuada) {
      VARIANTES_ACENTUADAS.add(columna.slice(0, i) + acentuada + columna.slice(i + 1));
    }
  }
}

test("ninguna columna de la base quedo acentuada dentro de una consulta", () => {
  const sucios = [];
  for (const archivo of CODIGO_DE_LA_APP.filter((f) => f.endsWith(".js"))) {
    const lineas = fs.readFileSync(archivo, "utf8").split("\n");
    lineas.forEach((linea, i) => {
      for (const mala of VARIANTES_ACENTUADAS) {
        // Solo cuenta si va pegada a un punto, o sea usada como columna de una
        // tabla: `n.leída`, `i.código`. Asi fueron los dos bugs reales.
        //
        // Aceptar tambien un espacio antes marcaba prosa legitima -"Comentario
        // de gestión:", "Cerrar sesión"- que esta bien acentuada y debe
        // quedarse asi. Un aviso que se equivoca se termina ignorando, y
        // entonces no sirve de nada.
        const comoColumna = new RegExp(`\\.${mala}\\b`);
        if (comoColumna.test(linea)) {
          sucios.push(`${path.relative(RAIZ, archivo)}:${i + 1} -> "${mala}"`);
          break;
        }
      }
    });
  }

  assert.deepEqual(
    sucios,
    [],
    `columnas acentuadas en SQL (fallarian SOLO en produccion):\n  ${sucios.join("\n  ")}`
  );
});

// ── 4. Los dos motores tienen que ofrecer lo mismo ─────────────────────────
// El portal corre sobre SQLite en local y PostgreSQL en produccion. Cada vez
// que se agrega una notificacion hay que agregarla en los dos servicios; si se
// olvida uno, funciona en las pruebas y revienta en produccion.
test("notificacionesService y su gemelo de PostgreSQL exponen lo mismo", () => {
  const sqlite = require("../services/notificacionesService");
  const postgres = require("../services/notificacionesPgService");

  const creadoras = Object.keys(sqlite).filter((k) => k.startsWith("create"));
  const faltantes = creadoras.filter((k) => typeof postgres[k] !== "function");

  assert.deepEqual(
    faltantes,
    [],
    `estan en SQLite pero no en PostgreSQL, asi que fallarian solo en produccion: ${faltantes.join(", ")}`
  );
});

// ── 6. Llamadas del frontend a rutas que no existen ────────────────────────
// feedback-ui.js llamaba a "/feedback" en vez de "/api/feedback": el servidor
// respondia 404, el feedback nunca se guardo y nadie recibio un solo aviso.
// apiRequest no agrega el prefijo, asi que cada ruta literal debe traerlo y
// apuntar a algo montado en server.js.
test("toda llamada a la API del frontend apunta a una ruta montada", () => {
  const server = fs.readFileSync(path.join(RAIZ, "backend", "server.js"), "utf8");
  const montadas = new Set(
    [...server.matchAll(/app\.use\(\s*["'`](\/api\/[^"'`]+)["'`]/g)].map((m) => m[1])
  );
  assert.ok(montadas.size > 5, "no se pudieron leer las rutas de server.js");

  const malas = [];
  const llamada = /(?:apiRequest|\bfn)\(\s*["'`](\/[^"'`$?]*)/g;
  for (const archivo of CODIGO_DE_LA_APP.filter((f) => f.includes(`${path.sep}frontend${path.sep}`))) {
    if (!archivo.endsWith(".js")) continue;
    const texto = fs.readFileSync(archivo, "utf8");
    for (const m of texto.matchAll(llamada)) {
      const ruta = m[1];
      const linea = texto.slice(0, m.index).split("\n").length;
      const donde = `${path.relative(RAIZ, archivo)}:${linea} ${ruta}`;
      if (!ruta.startsWith("/api/")) {
        malas.push(`${donde} (falta /api)`);
        continue;
      }
      const montada = [...montadas].some((base) => ruta === base || ruta.startsWith(`${base}/`));
      if (!montada) malas.push(`${donde} (no esta montada en server.js)`);
    }
  }

  assert.deepEqual(malas, [], `Rutas de API inexistentes:\n${malas.join("\n")}`);
});

// ── 7. Nombres importados que el modulo no exporta ─────────────────────────
// feedback.js y novedades.js hacian `const { HttpError } = require("../utils/
// errors")`, pero ese archivo solo exporta AppError. HttpError quedaba
// undefined y cada validacion ("titulo obligatorio", "id invalido") reventaba
// con TypeError: el usuario veia un error 500 en vez del mensaje. node --check
// no lo ve; solo falla al pasar por esa linea.
function nombresExportados(fuente) {
  const nombres = new Set();
  for (const m of fuente.matchAll(/(?:module\.)?exports\.([A-Za-z_$][\w$]*)\s*=/g)) nombres.add(m[1]);
  const inicio = fuente.lastIndexOf("module.exports = {");
  if (inicio >= 0) {
    let i = fuente.indexOf("{", inicio);
    let nivel = 0;
    let fin = -1;
    for (let j = i; j < fuente.length; j++) {
      if (fuente[j] === "{") nivel++;
      else if (fuente[j] === "}" && --nivel === 0) { fin = j; break; }
    }
    if (fin < 0) return null;
    // Sin comentarios: una coma dentro de un comentario partia mal la lista.
    const cuerpo = fuente
      .slice(i + 1, fin)
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");
    // Partir por comas de primer nivel.
    let actual = "";
    nivel = 0;
    const partes = [];
    for (const c of cuerpo) {
      if ("{([".includes(c)) nivel++;
      if ("})]".includes(c)) nivel--;
      if (c === "," && nivel === 0) { partes.push(actual); actual = ""; } else actual += c;
    }
    partes.push(actual);
    for (const parte of partes) {
      const limpia = parte.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "").trim();
      if (!limpia) continue;
      if (limpia.startsWith("...")) return null; // no se puede saber estaticamente
      const nombre = limpia.match(/^(?:async\s+)?["']?([A-Za-z_$][\w$]*)/);
      if (nombre) nombres.add(nombre[1]);
    }
  }
  return nombres.size ? nombres : null;
}

function resolverRequire(desde, spec) {
  let destino = path.resolve(path.dirname(desde), spec);
  if (!fs.existsSync(destino) && fs.existsSync(`${destino}.js`)) destino = `${destino}.js`;
  else if (fs.existsSync(destino) && fs.statSync(destino).isDirectory()) destino = path.join(destino, "index.js");
  return fs.existsSync(destino) ? destino : null;
}

// Solo el codigo que de verdad carga el servidor: hay una capa vieja
// (models/*.model.js, services/*.service.js) que ya no se usa y que importa
// funciones que no existen; marcarla seria ruido.
function alcanzablesDesde(entrada) {
  const vistos = new Set();
  const pila = [entrada];
  while (pila.length) {
    const archivo = pila.pop();
    if (vistos.has(archivo)) continue;
    vistos.add(archivo);
    const texto = fs.readFileSync(archivo, "utf8");
    for (const m of texto.matchAll(/require\(\s*["'](\.{1,2}\/[^"']+)["']\s*\)/g)) {
      const destino = resolverRequire(archivo, m[1]);
      if (destino && destino.endsWith(".js")) pila.push(destino);
    }
  }
  return vistos;
}

test("cada nombre que se importa con require existe en su modulo", () => {
  const faltan = [];
  const backend = [...alcanzablesDesde(path.join(RAIZ, "backend", "server.js"))];
  assert.ok(backend.length > 20, "no se pudo recorrer el codigo desde server.js");
  for (const archivo of backend) {
    const texto = fs.readFileSync(archivo, "utf8");
    for (const m of texto.matchAll(/const\s*\{([^}]+)\}\s*=\s*require\(\s*["'](\.{1,2}\/[^"']+)["']\s*\)/g)) {
      const destino = resolverRequire(archivo, m[2]);
      if (!destino) {
        faltan.push(`${path.relative(RAIZ, archivo)}: no existe ${m[2]}`);
        continue;
      }
      const exportados = nombresExportados(fs.readFileSync(destino, "utf8"));
      if (!exportados) continue;
      for (const pedido of m[1].split(",")) {
        const nombre = pedido.split(":")[0].trim();
        if (nombre && !exportados.has(nombre)) {
          faltan.push(`${path.relative(RAIZ, archivo)}: ${m[2]} no exporta ${nombre}`);
        }
      }
    }
  }
  assert.deepEqual(faltan, [], `Imports que quedan undefined:\n${faltan.join("\n")}`);
});
