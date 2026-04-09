const test = require("node:test");
const assert = require("node:assert/strict");

const inventarioService = require("../services/inventario.service");
const { AppError } = require("../utils/errors");

test("registerMovement valida cantidad distinta de cero", async () => {
  await assert.rejects(
    async () => {
      await inventarioService.registerMovement(
        { id: 1, role: "Administrador" },
        { repuestoId: 1, tipo: "ajuste", cantidad: 0 }
      );
    },
    (error) => error instanceof AppError && error.code === "VALIDATION_ERROR"
  );
});

