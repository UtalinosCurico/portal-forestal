-- Migracion V3: Envios de stock + Notificaciones operacionales
-- Fecha: 2026-03-11

CREATE TABLE IF NOT EXISTS envios_stock (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  repuesto_id INTEGER NOT NULL,
  cantidad INTEGER NOT NULL,
  equipo_destino_id INTEGER NOT NULL,
  solicitado_por INTEGER NOT NULL,
  autorizado_por INTEGER,
  fecha_envio TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  fecha_recepcion TEXT,
  comentario TEXT,
  estado_visual TEXT NOT NULL DEFAULT 'PREPARADO',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT,
  FOREIGN KEY (repuesto_id) REFERENCES inventario(id),
  FOREIGN KEY (equipo_destino_id) REFERENCES equipos(id),
  FOREIGN KEY (solicitado_por) REFERENCES usuarios(id),
  FOREIGN KEY (autorizado_por) REFERENCES usuarios(id)
);

CREATE TABLE IF NOT EXISTS notificaciones (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tipo TEXT NOT NULL,
  titulo TEXT NOT NULL,
  mensaje TEXT NOT NULL,
  rol_destino TEXT,
  usuario_destino_id INTEGER,
  equipo_id INTEGER,
  referencia_id INTEGER,
  leida INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  read_at TEXT,
  FOREIGN KEY (usuario_destino_id) REFERENCES usuarios(id),
  FOREIGN KEY (equipo_id) REFERENCES equipos(id)
);
