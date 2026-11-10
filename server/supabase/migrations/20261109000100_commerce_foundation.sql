-- CN-57. Supabase CLI aplica esta migration dentro de su transacción.
-- Solo infraestructura. El flujo HTTP conserva sus Stores In-Memory hasta CN-58/CN-59.
CREATE SCHEMA commerce;
REVOKE ALL ON SCHEMA commerce FROM PUBLIC;

-- Rol de permisos sin LOGIN ni contraseña. El operador vincula un login runtime separado.
-- Este bloque anónimo no crea Stored Procedures, Functions ni Triggers persistentes.
DO $roles$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'commerce_runtime') THEN
    CREATE ROLE commerce_runtime NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  ELSIF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'commerce_runtime'
    AND (rolcanlogin OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls)) THEN
    RAISE EXCEPTION 'commerce_runtime tiene permisos incompatibles con el rol runtime.';
  END IF;
END;
$roles$;

CREATE TABLE commerce.orders (
  id TEXT PRIMARY KEY CHECK (btrim(id) <> ''),
  order_number TEXT NOT NULL UNIQUE CHECK (btrim(order_number) <> ''),
  owner_user_id TEXT NOT NULL CHECK (owner_user_id ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$'),
  user_snapshot JSONB NOT NULL,
  contract_version SMALLINT NOT NULL DEFAULT 1 CHECK (contract_version >= 1),
  branch_id TEXT CHECK (branch_id IN ('san_jose', 'alajuela', 'cartago', 'heredia')),
  buyer_snapshot JSONB NOT NULL CHECK (jsonb_typeof(buyer_snapshot) = 'object'),
  delivery_snapshot JSONB NOT NULL CHECK (jsonb_typeof(delivery_snapshot) = 'object'),
  items_snapshot JSONB NOT NULL CHECK (CASE WHEN jsonb_typeof(items_snapshot) = 'array' THEN jsonb_array_length(items_snapshot) > 0 ELSE FALSE END),
  currency TEXT NOT NULL CHECK (currency = 'CRC'),
  -- NUMERIC sin escala. El límite reproduce el guard financiero actual y excluye NaN e Infinity.
  subtotal NUMERIC NOT NULL CHECK (subtotal >= 0 AND subtotal <= 90071992547409.9),
  tax NUMERIC NOT NULL CHECK (tax >= 0 AND tax <= 90071992547409.9),
  shipping NUMERIC NOT NULL CHECK (shipping >= 0 AND shipping <= 90071992547409.9),
  total NUMERIC NOT NULL CHECK (total >= 0 AND total <= 90071992547409.9),
  terms_accepted BOOLEAN NOT NULL CHECK (terms_accepted),
  terms_version TEXT NOT NULL CHECK (btrim(terms_version) <> ''),
  terms_accepted_at TIMESTAMPTZ(3) NOT NULL,
  order_status TEXT NOT NULL CHECK (order_status IN ('PENDING', 'CONFIRMED')),
  payment_status TEXT NOT NULL CHECK (payment_status IN ('PENDING', 'APPROVED', 'DECLINED', 'ERROR')),
  created_at TIMESTAMPTZ(3) NOT NULL,
  updated_at TIMESTAMPTZ(3) NOT NULL,
  UNIQUE (id, owner_user_id),
  CONSTRAINT order_status_pair CHECK (
    (order_status = 'CONFIRMED' AND payment_status = 'APPROVED') OR
    (order_status = 'PENDING' AND payment_status IN ('PENDING', 'DECLINED', 'ERROR'))
  ),
  -- IS TRUE rechaza también claves JSON ausentes, que de otro modo producirían NULL en un CHECK.
  CONSTRAINT order_user_snapshot CHECK ((
    jsonb_typeof(user_snapshot) = 'object' AND
    user_snapshot - ARRAY['id', 'displayName', 'role', 'company'] = '{}'::jsonb AND
    jsonb_typeof(user_snapshot->'id') = 'string' AND user_snapshot->>'id' = owner_user_id AND
    jsonb_typeof(user_snapshot->'displayName') = 'string' AND btrim(user_snapshot->>'displayName') <> '' AND
    (
      (user_snapshot->>'role' = 'B2C' AND NOT (user_snapshot ? 'company')) OR
      (user_snapshot->>'role' = 'B2B' AND jsonb_typeof(user_snapshot->'company') = 'object' AND
        (user_snapshot->'company') - ARRAY['id', 'name'] = '{}'::jsonb AND
        jsonb_typeof(user_snapshot->'company'->'id') = 'string' AND btrim(user_snapshot->'company'->>'id') <> '' AND
        jsonb_typeof(user_snapshot->'company'->'name') = 'string' AND btrim(user_snapshot->'company'->>'name') <> '')
    )
  ) IS TRUE)
);

CREATE INDEX orders_owner_created_idx ON commerce.orders (owner_user_id, created_at DESC, id);

CREATE TABLE commerce.order_creation_requests (
  -- La key sigue siendo global. Otro owner no obtiene una Order nueva por reutilizarla.
  idempotency_key TEXT PRIMARY KEY CHECK (btrim(idempotency_key) <> ''),
  owner_user_id TEXT NOT NULL,
  canonical_payload TEXT NOT NULL CHECK (btrim(canonical_payload) <> ''),
  canonical_version SMALLINT NOT NULL DEFAULT 1 CHECK (canonical_version >= 1),
  order_id TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT creation_order_owner_fk FOREIGN KEY (order_id, owner_user_id)
    REFERENCES commerce.orders (id, owner_user_id) DEFERRABLE INITIALLY DEFERRED
);

CREATE TABLE commerce.payment_attempts (
  order_id TEXT NOT NULL REFERENCES commerce.orders (id),
  idempotency_key TEXT NOT NULL CHECK (btrim(idempotency_key) <> ''),
  scenario TEXT NOT NULL CHECK (scenario IN ('PAYMENT_APPROVED', 'PAYMENT_DECLINED', 'PAYMENT_ERROR')),
  result TEXT NOT NULL CHECK (result IN ('PAYMENT_APPROVED', 'PAYMENT_DECLINED', 'PAYMENT_ERROR')),
  processed_at TIMESTAMPTZ(3) NOT NULL,
  -- Snapshot histórico completo para Replay, aunque la Order actual tenga otro estado tras un Retry.
  order_snapshot JSONB NOT NULL,
  PRIMARY KEY (order_id, idempotency_key),
  CONSTRAINT payment_snapshot CHECK ((
    jsonb_typeof(order_snapshot) = 'object' AND order_snapshot->>'id' = order_id AND
    order_snapshot->>'currency' = 'CRC' AND
    ((result = 'PAYMENT_APPROVED' AND order_snapshot->>'orderStatus' = 'CONFIRMED' AND order_snapshot->>'paymentStatus' = 'APPROVED') OR
     (result = 'PAYMENT_DECLINED' AND order_snapshot->>'orderStatus' = 'PENDING' AND order_snapshot->>'paymentStatus' = 'DECLINED') OR
     (result = 'PAYMENT_ERROR' AND order_snapshot->>'orderStatus' = 'PENDING' AND order_snapshot->>'paymentStatus' = 'ERROR'))
  ) IS TRUE)
);

REVOKE ALL ON ALL TABLES IN SCHEMA commerce FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA commerce FROM commerce_runtime;

-- Supabase posee estos roles. PostgreSQL local puede carecer de ellos.
DO $api_roles$
DECLARE api_role TEXT;
BEGIN
  FOREACH api_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = api_role) THEN
      EXECUTE format('REVOKE ALL ON SCHEMA commerce FROM %I', api_role);
      EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA commerce FROM %I', api_role);
    END IF;
  END LOOP;
END;
$api_roles$;

GRANT USAGE ON SCHEMA commerce TO commerce_runtime;
GRANT SELECT, INSERT ON commerce.orders, commerce.order_creation_requests, commerce.payment_attempts TO commerce_runtime;
GRANT UPDATE (order_status, payment_status, updated_at) ON commerce.orders TO commerce_runtime;

COMMENT ON SCHEMA commerce IS 'Persistencia privada de Express. Mantener fuera de los schemas expuestos en la Data API.';
COMMENT ON TABLE commerce.orders IS 'Snapshot comercial inmutable y estados actuales. Owner validado por Server, sin FK a Algolia.';
COMMENT ON TABLE commerce.order_creation_requests IS 'Key global, owner y payload canónico. Debe confirmarse en la misma transacción que la Order.';
COMMENT ON TABLE commerce.payment_attempts IS 'Historial append-only para Payment Replay. No contiene campos de tarjeta.';
