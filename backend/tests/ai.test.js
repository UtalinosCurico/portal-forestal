// Los tests anteriores cubrian el reintento de peticiones hecho a mano. Esa
// logica se reemplazo por la SDK oficial, que reintenta sola, asi que probarla
// aqui seria probar codigo de Anthropic.
//
// Lo que si vale la pena asegurar es la propiedad de seguridad del asistente:
// solo puede leer, y siempre a traves del usuario autenticado, para que un
// JEFE_FAENA no pueda sacarle datos de otro equipo por mucho que pregunte.

const test = require("node:test");
const assert = require("node:assert/strict");

process.env.NODE_ENV = "test";

const { construirHerramientas } = require("../services/aiToolsService");
const { __private: aiPrivate } = require("../routes/ai");

const ACTOR = { id: 7, nombre: "Jefe de prueba", rol: "JEFE_FAENA", equipo_id: 2 };
const ADMIN = { id: 1, nombre: "Admin de prueba", rol: "ADMIN", equipo_id: null };

function porNombre(herramientas, nombre) {
  return herramientas.find((h) => h.name === nombre);
}

// Mandar `thinking: adaptive` o `effort` a un modelo que no los soporta devuelve
// 400 y el asistente deja de responder. Paso una vez por no revisarlo.
test("no se manda razonamiento adaptativo a modelos que no lo soportan", () => {
  const { soportaRazonamientoAdaptativo } = aiPrivate;

  for (const modelo of ["claude-haiku-4-5", "claude-sonnet-4-5", "claude-opus-4-5"]) {
    assert.equal(
      soportaRazonamientoAdaptativo(modelo),
      false,
      `${modelo} no soporta thinking adaptativo ni effort`
    );
  }

  for (const modelo of ["claude-opus-4-8", "claude-opus-4-6", "claude-sonnet-5", "claude-fable-5"]) {
    assert.equal(soportaRazonamientoAdaptativo(modelo), true, `${modelo} si lo soporta`);
  }
});

test("el asistente solo expone herramientas de consulta", () => {
  const herramientas = construirHerramientas(ADMIN);
  const nombres = herramientas.map((h) => h.name).sort();

  assert.deepEqual(nombres, ["buscar_solicitudes", "consultar_consumo", "listar_equipos"]);

  // Ninguna herramienta debe poder crear, cambiar ni borrar nada.
  const verbosProhibidos = /crear|create|actualizar|update|eliminar|delete|borrar|enviar|send/i;
  for (const herramienta of herramientas) {
    assert.ok(
      !verbosProhibidos.test(herramienta.name),
      `la herramienta "${herramienta.name}" sugiere una accion que modifica datos`
    );
  }
});

// El modulo Reportes -consumo por producto y stock sugerido- es informacion de
// gestion y no se le muestra a faena. Si el asistente igual la contara, la
// restriccion seria de fachada: bastaria preguntarle a PumAI.
test("a faena el asistente no le entrega consumo ni stock sugerido", () => {
  for (const rol of ["JEFE_FAENA", "MECANICO", "OPERADOR"]) {
    const nombres = construirHerramientas({ id: 7, rol, equipo_id: 2 }).map((h) => h.name);
    assert.ok(
      !nombres.includes("consultar_consumo"),
      `${rol} no deberia tener consultar_consumo, tiene: ${nombres.join(", ")}`
    );
    assert.ok(nombres.includes("buscar_solicitudes"), `${rol} si puede consultar sus solicitudes`);
  }

  for (const rol of ["ADMIN", "SUPERVISOR"]) {
    const nombres = construirHerramientas({ id: 1, rol, equipo_id: null }).map((h) => h.name);
    assert.ok(nombres.includes("consultar_consumo"), `${rol} si administra y necesita el consumo`);
  }
});

test("cada herramienta consulta con el usuario autenticado, no con uno libre", async () => {
  const actoresRecibidos = [];

  // Se interceptan los servicios para ver con que actor los llama la herramienta.
  const consumoService = require("../services/consumoService");
  const solicitudesService = require("../services/solicitudesService");
  const equiposService = require("../services/equiposService");

  const originales = {
    getConsumo: consumoService.getConsumo,
    listSolicitudes: solicitudesService.listSolicitudes,
    listEquipos: equiposService.listEquipos,
  };

  consumoService.getConsumo = async (actor) => {
    actoresRecibidos.push(actor);
    return { periodo: { desde: null, hasta: null, agrupacion: "mes" }, productos: [] };
  };
  solicitudesService.listSolicitudes = async (actor) => {
    actoresRecibidos.push(actor);
    return { data: [] };
  };
  equiposService.listEquipos = async (actor) => {
    actoresRecibidos.push(actor);
    return { data: [] };
  };

  try {
    // Se prueba con los dos: el que tiene todas las herramientas y el de faena,
    // que tiene menos. En ambos casos el actor debe viajar tal cual.
    for (const quien of [ADMIN, ACTOR]) {
      actoresRecibidos.length = 0;
      const herramientas = construirHerramientas(quien);
      for (const herramienta of herramientas) {
        await herramienta.run({});
      }

      assert.equal(
        actoresRecibidos.length,
        herramientas.length,
        "cada herramienta debe consultar un servicio"
      );
      for (const actor of actoresRecibidos) {
        assert.equal(actor, quien, "la herramienta debe pasar el usuario autenticado tal cual");
      }
    }
  } finally {
    consumoService.getConsumo = originales.getConsumo;
    solicitudesService.listSolicitudes = originales.listSolicitudes;
    equiposService.listEquipos = originales.listEquipos;
  }
});

test("una herramienta no puede elegir por que usuario consultar", async () => {
  const consumoService = require("../services/consumoService");
  const original = consumoService.getConsumo;

  let actorUsado = null;
  consumoService.getConsumo = async (actor) => {
    actorUsado = actor;
    return { periodo: { desde: null, hasta: null, agrupacion: "mes" }, productos: [] };
  };

  try {
    const consultarConsumo = porNombre(construirHerramientas(ADMIN), "consultar_consumo");

    // Aunque el modelo intente colar otro usuario en los argumentos, se ignora:
    // el actor viene del token, no de lo que escriba el modelo.
    await consultarConsumo.run({ usuarioId: 999, actor: { rol: "OPERADOR" }, rol: "OPERADOR" });

    assert.equal(actorUsado, ADMIN);
    assert.equal(actorUsado.rol, "ADMIN");
  } finally {
    consumoService.getConsumo = original;
  }
});
