-- Orders V2 conservan en PostgreSQL el contexto comercial autoritativo.
ALTER TABLE commerce.orders
  ADD COLUMN pricing_type TEXT CHECK (pricing_type IN ('RETAIL', 'WHOLESALE')),
  ADD COLUMN commercial_policy_version TEXT;

ALTER TABLE commerce.orders
  ADD CONSTRAINT order_commercial_contract CHECK (
    (contract_version = 1 AND branch_id IS NULL AND pricing_type IS NULL AND commercial_policy_version IS NULL) OR
    (contract_version = 2 AND branch_id IS NOT NULL AND pricing_type IS NOT NULL
      AND commercial_policy_version IS NOT NULL AND btrim(commercial_policy_version) <> ''
      AND user_snapshot->>'role' IS NOT NULL AND user_snapshot->>'role' IN ('B2C', 'B2B')
      AND ((user_snapshot->>'role' = 'B2C' AND pricing_type = 'RETAIL') OR
           (user_snapshot->>'role' = 'B2B' AND pricing_type = 'WHOLESALE')))
  );

ALTER TABLE commerce.order_creation_requests
  ADD CONSTRAINT order_creation_contract_version CHECK (canonical_version IN (1, 2));
