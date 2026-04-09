INSERT INTO roles (name, description) VALUES
  ('Administrador', 'Acceso total al sistema'),
  ('Supervisor', 'Revisa y aprueba solicitudes'),
  ('Jefe de faena', 'Gestiona solicitudes de su faena'),
  ('Operador', 'Crea solicitudes y ve solo las propias')
ON CONFLICT (name) DO NOTHING;

INSERT INTO faenas (nombre, ubicacion)
VALUES ('Faena Maule Norte Base', 'Maule Norte')
ON CONFLICT (nombre) DO NOTHING;

INSERT INTO powerbi_configs (workspace_id, report_id, dataset_id, allowed_roles, activa)
SELECT
  'workspace-placeholder',
  'report-placeholder',
  'dataset-placeholder',
  ARRAY['Administrador','Supervisor'],
  true
WHERE NOT EXISTS (
  SELECT 1
  FROM powerbi_configs
  WHERE workspace_id = 'workspace-placeholder'
    AND report_id = 'report-placeholder'
);
