-- Ajuste incremental: registrar confirmacion de recepcion en envios_stock
-- Ejecutar una sola vez si la columna no existe.
ALTER TABLE envios_stock ADD COLUMN fecha_recepcion TEXT;

