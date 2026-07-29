// El riesgo aca es al reves que en analisis.test.js: que NO avise cuando
// deberia. Se prueba con datos sinteticos (mockeando solicitudesService) para
// no depender del contenido real de la base ni del orden en que corran otros
// tests.

const test = require("node:test");
const assert = require("node:assert/strict");

process.env.NODE_ENV = "test";

const solicitudesService = require("../services/solicitudesService");
const productoAliasService = require("../services/productoAliasService");
const notificacionesService = require("../services/notificacionesService");
const alertas = require("../services/alertasService");

function solicitudDe(nombreItem, cantidad, diasAtras = 30) {
  const fecha = new Date(Date.now() - diasAtras * 86400000).toISOString().slice(0, 10);
  return {
    id: Math.floor(Math.random() * 100000),
    estado: "ENTREGADO",
    equipo: "Equipo de prueba",
    created_at: `${fecha} 09:00:00`,
    items: [{ nombre_item: nombreItem, cantidad }],
  };
}

/** Reemplaza temporalmente las dependencias externas y las restaura al final. */
async function conMocks({ historico }, fn) {
  const originales = {
    listSolicitudesForExport: solicitudesService.listSolicitudesForExport,
    buildResolver: productoAliasService.buildResolver,
  };

  solicitudesService.listSolicitudesForExport = async () => historico;
  productoAliasService.buildResolver = async () => ({
    resolver: (clave) => clave,
    nombreDe: () => "",
    nombrePersonalizadoDe: () => "",
    variantesDe: () => [],
  });

  try {
    await fn();
  } finally {
    solicitudesService.listSolicitudesForExport = originales.listSolicitudesForExport;
    productoAliasService.buildResolver = originales.buildResolver;
  }
}

test("no avisa con menos historial del minimo, aunque el pedido sea enorme", async () => {
  await conMocks(
    {
      historico: [
        solicitudDe("Cinta metrica", 5),
        solicitudDe("Cinta metrica", 6),
        solicitudDe("Cinta metrica", 4),
      ],
    },
    async () => {
      const resultado = await alertas.evaluarPedido({ nombreItem: "Cinta metrica", cantidad: 500 });
      assert.equal(resultado, null, "con solo 3 datos previos no hay base para decidir");
    }
  );
});

test("no avisa por un pedido dentro de lo normal", async () => {
  const historico = [16, 18, 20, 19, 17, 21, 20].map((c) => solicitudDe("Guantes", c));
  await conMocks({ historico }, async () => {
    const resultado = await alertas.evaluarPedido({ nombreItem: "Guantes", cantidad: 20 });
    assert.equal(resultado, null);
  });
});

test("avisa cuando el pedido se sale muchisimo de lo tipico", async () => {
  const historico = [16, 18, 20, 19, 17, 21, 20].map((c) => solicitudDe("Guantes", c));
  await conMocks({ historico }, async () => {
    const resultado = await alertas.evaluarPedido({ nombreItem: "Guantes", cantidad: 400 });
    assert.ok(resultado, "400 contra un tipico de ~18 deberia marcarse");
    assert.equal(resultado.nombre, "Guantes");
    assert.ok(resultado.veces_lo_tipico > 5);
  });
});

test("una solicitud rechazada no cuenta como historial", async () => {
  // Ocho "20" rechazados no deberian bajar el tipico ni servir de base.
  const rechazadas = Array.from({ length: 8 }, () => {
    const s = solicitudDe("Repuesto raro", 20);
    s.estado = "RECHAZADO";
    return s;
  });
  await conMocks({ historico: rechazadas }, async () => {
    const resultado = await alertas.evaluarPedido({ nombreItem: "Repuesto raro", cantidad: 20 });
    assert.equal(resultado, null, "sin historial valido (todo rechazado) no hay base para avisar");
  });
});

test("revisarPedidosNuevos notifica solo los items marcados, y nunca lanza", async () => {
  const historico = [16, 18, 20, 19, 17, 21, 20].map((c) => solicitudDe("Guantes", c));
  const llamadas = [];
  const original = notificacionesService.createPedidoInusualNotification;
  notificacionesService.createPedidoInusualNotification = async (payload) => {
    llamadas.push(payload);
  };

  try {
    await conMocks({ historico }, async () => {
      await alertas.revisarPedidosNuevos({
        solicitudId: 999,
        equipoId: 3,
        equipoNombre: "Equipo X",
        items: [
          { nombre_item: "Guantes", cantidad: 19 }, // normal: no deberia notificar
          { nombre_item: "Guantes", cantidad: 500 }, // inusual: si deberia
        ],
      });
    });

    assert.equal(llamadas.length, 1, "solo el pedido inusual genera notificacion");
    assert.equal(llamadas[0].solicitudId, 999);
    assert.equal(llamadas[0].cantidad, 500);
  } finally {
    notificacionesService.createPedidoInusualNotification = original;
  }
});

test("un error al revisar no se propaga (no debe tumbar la creacion de la solicitud)", async () => {
  const original = solicitudesService.listSolicitudesForExport;
  solicitudesService.listSolicitudesForExport = async () => {
    throw new Error("fallo simulado de base de datos");
  };

  try {
    await assert.doesNotReject(
      alertas.revisarPedidosNuevos({
        solicitudId: 1,
        items: [{ nombre_item: "X", cantidad: 10 }],
      })
    );
  } finally {
    solicitudesService.listSolicitudesForExport = original;
  }
});
