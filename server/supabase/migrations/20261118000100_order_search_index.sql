-- CN-65. Revisiones de la proyección hacia el índice Algolia orders.
-- PostgreSQL sigue siendo la fuente autoritativa; estas columnas no modifican snapshots, importes ni estados.
-- index_version: revisión autoritativa vigente. indexed_version: última revisión confirmada en Algolia.
-- Las Orders existentes quedan pendientes (1 > 0) para la indexación inicial controlada.
ALTER TABLE commerce.orders
  ADD COLUMN index_version INTEGER NOT NULL DEFAULT 1 CHECK (index_version >= 1),
  ADD COLUMN indexed_version INTEGER NOT NULL DEFAULT 0 CHECK (indexed_version >= 0),
  ADD COLUMN index_synced_at TIMESTAMPTZ(3),
  ADD COLUMN index_attempted_at TIMESTAMPTZ(3),
  ADD COLUMN index_failure_count INTEGER NOT NULL DEFAULT 0 CHECK (index_failure_count >= 0),
  -- Solo categorías sanitizadas; nunca mensajes del SDK, credenciales ni datos de la Order.
  ADD COLUMN index_last_error TEXT CHECK (index_last_error IN ('configuration', 'unavailable', 'rejected', 'invalid-record')),
  -- Lease breve por Order: evita escrituras concurrentes y expira solo si el proceso se detiene.
  ADD COLUMN index_lease_token UUID,
  ADD COLUMN index_lease_expires_at TIMESTAMPTZ(3);

ALTER TABLE commerce.orders
  ADD CONSTRAINT order_index_versions CHECK (indexed_version <= index_version),
  ADD CONSTRAINT order_index_lease CHECK ((index_lease_token IS NULL) = (index_lease_expires_at IS NULL));

CREATE INDEX orders_index_pending_idx ON commerce.orders (id) WHERE indexed_version < index_version;

GRANT UPDATE (index_version, indexed_version, index_synced_at, index_attempted_at, index_failure_count,
  index_last_error, index_lease_token, index_lease_expires_at) ON commerce.orders TO commerce_runtime;

COMMENT ON COLUMN commerce.orders.index_version IS 'Revisión autoritativa de la proyección Algolia; aumenta al cambiar estados.';
COMMENT ON COLUMN commerce.orders.indexed_version IS 'Última revisión confirmada en el índice Algolia orders.';
