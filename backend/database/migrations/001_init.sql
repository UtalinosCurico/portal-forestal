CREATE TABLE IF NOT EXISTS roles (
  id SERIAL PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  description TEXT
);

CREATE TABLE IF NOT EXISTS faenas (
  id SERIAL PRIMARY KEY,
  nombre TEXT UNIQUE NOT NULL,
  ubicacion TEXT,
  activa BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  nombre TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role_id INT NOT NULL REFERENCES roles(id),
  faena_id INT REFERENCES faenas(id),
  activo BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS refresh_tokens (
  id SERIAL PRIMARY KEY,
  user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS equipos (
  id SERIAL PRIMARY KEY,
  codigo TEXT UNIQUE NOT NULL,
  nombre TEXT NOT NULL,
  faena_id INT NOT NULL REFERENCES faenas(id),
  activo BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS repuestos (
  id SERIAL PRIMARY KEY,
  codigo TEXT UNIQUE NOT NULL,
  nombre TEXT NOT NULL,
  unidad_medida TEXT NOT NULL,
  activo BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS stock_bodega (
  id SERIAL PRIMARY KEY,
  repuesto_id INT UNIQUE NOT NULL REFERENCES repuestos(id),
  cantidad NUMERIC(12,2) NOT NULL DEFAULT 0,
  last_updated TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS stock_faena (
  id SERIAL PRIMARY KEY,
  faena_id INT NOT NULL REFERENCES faenas(id),
  repuesto_id INT NOT NULL REFERENCES repuestos(id),
  cantidad NUMERIC(12,2) NOT NULL DEFAULT 0,
  last_updated TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(faena_id, repuesto_id)
);

CREATE TABLE IF NOT EXISTS solicitudes (
  id SERIAL PRIMARY KEY,
  folio TEXT UNIQUE NOT NULL,
  estado TEXT NOT NULL CHECK (estado IN ('pendiente', 'en revisión', 'aprobado', 'en despacho', 'entregado', 'rechazado')),
  solicitante_id INT NOT NULL REFERENCES users(id),
  equipo_id INT REFERENCES equipos(id),
  faena_id INT NOT NULL REFERENCES faenas(id),
  comentario TEXT,
  fecha_revision TIMESTAMPTZ,
  revisado_por INT REFERENCES users(id),
  fecha_despacho TIMESTAMPTZ,
  despachado_por INT REFERENCES users(id),
  fecha_recepcion TIMESTAMPTZ,
  recibido_por INT REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS solicitud_items (
  id SERIAL PRIMARY KEY,
  solicitud_id INT NOT NULL REFERENCES solicitudes(id) ON DELETE CASCADE,
  repuesto_id INT NOT NULL REFERENCES repuestos(id),
  cantidad NUMERIC(12,2) NOT NULL CHECK (cantidad > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS solicitud_historial (
  id SERIAL PRIMARY KEY,
  solicitud_id INT NOT NULL REFERENCES solicitudes(id) ON DELETE CASCADE,
  estado_anterior TEXT,
  estado_nuevo TEXT NOT NULL,
  accion TEXT NOT NULL,
  comentario TEXT,
  user_id INT NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS inventario_movimientos (
  id SERIAL PRIMARY KEY,
  repuesto_id INT NOT NULL REFERENCES repuestos(id),
  faena_id INT REFERENCES faenas(id),
  solicitud_id INT REFERENCES solicitudes(id),
  user_id INT NOT NULL REFERENCES users(id),
  tipo TEXT NOT NULL CHECK (tipo IN ('ingreso', 'ajuste', 'despacho', 'recepcion', 'traslado')),
  cantidad NUMERIC(12,2) NOT NULL CHECK (cantidad <> 0),
  origen TEXT,
  destino TEXT,
  comentario TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS powerbi_configs (
  id SERIAL PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  report_id TEXT NOT NULL,
  dataset_id TEXT,
  allowed_roles TEXT[] NOT NULL DEFAULT '{}',
  activa BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(workspace_id, report_id)
);

CREATE INDEX IF NOT EXISTS idx_users_role_id ON users(role_id);
CREATE INDEX IF NOT EXISTS idx_users_faena_id ON users(faena_id);
CREATE INDEX IF NOT EXISTS idx_solicitudes_faena_id ON solicitudes(faena_id);
CREATE INDEX IF NOT EXISTS idx_solicitudes_solicitante_id ON solicitudes(solicitante_id);
CREATE INDEX IF NOT EXISTS idx_solicitudes_estado ON solicitudes(estado);
CREATE INDEX IF NOT EXISTS idx_solicitud_historial_solicitud_id ON solicitud_historial(solicitud_id);
CREATE INDEX IF NOT EXISTS idx_inventario_movimientos_solicitud_id ON inventario_movimientos(solicitud_id);
