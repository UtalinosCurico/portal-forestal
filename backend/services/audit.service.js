function buildSolicitudTimeline(historialRows) {
  return historialRows.map((row) => ({
    id: row.id,
    accion: row.accion,
    estadoAnterior: row.estado_anterior,
    estadoNuevo: row.estado_nuevo,
    comentario: row.comentario,
    actor: row.actor_nombre,
    fecha: row.created_at,
  }));
}

module.exports = {
  buildSolicitudTimeline,
};

