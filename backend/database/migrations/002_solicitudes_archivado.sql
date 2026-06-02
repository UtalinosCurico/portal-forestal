ALTER TABLE solicitudes
  ADD COLUMN IF NOT EXISTS archivado BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_solicitudes_archivado ON solicitudes(archivado);
