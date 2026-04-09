-- Migracion Portal FMN: equipos + asignacion de usuarios + stock por equipo

CREATE TABLE IF NOT EXISTS equipos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre_equipo TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE usuarios ADD COLUMN equipo_id INTEGER;
ALTER TABLE usuarios ADD COLUMN password_hash TEXT;

CREATE TABLE IF NOT EXISTS equipo_stock (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  equipo_id INTEGER NOT NULL,
  repuesto_id INTEGER NOT NULL,
  stock INTEGER NOT NULL DEFAULT 0,
  ultima_actualizacion TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (equipo_id, repuesto_id),
  FOREIGN KEY (equipo_id) REFERENCES equipos(id),
  FOREIGN KEY (repuesto_id) REFERENCES inventario(id)
);

ALTER TABLE solicitudes ADD COLUMN equipo_id INTEGER;

INSERT OR IGNORE INTO equipos (id, nombre_equipo) VALUES
  (1, 'Maule Norte 2'),
  (2, 'Maule Norte 3'),
  (3, 'Forest Saint');

-- Actualiza password_hash desde password si aplica
UPDATE usuarios
SET password_hash = password
WHERE password_hash IS NULL
  AND password IS NOT NULL;

-- Asigna equipo por defecto a usuarios operativos
UPDATE usuarios SET equipo_id = 1 WHERE role = 'JEFE_FAENA' AND equipo_id IS NULL;
UPDATE usuarios SET equipo_id = 2 WHERE role = 'OPERADOR' AND equipo_id IS NULL;
