-- Additive only. Existing catalogues, counts and legacy adjustments are retained.
CREATE TABLE IF NOT EXISTS inventory_requests (
 request_id UUID PRIMARY KEY,
 payload_hash TEXT NOT NULL,
 response JSONB,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS inventory_sheets_outbox (
 event_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 count_id BIGINT NOT NULL UNIQUE REFERENCES inventory_counts(id),
 payload JSONB NOT NULL,
 attempts INTEGER NOT NULL DEFAULT 0,
 delivered_at TIMESTAMPTZ,
 last_error TEXT,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS inventory_sheets_pending ON inventory_sheets_outbox(count_id) WHERE delivered_at IS NULL;
CREATE OR REPLACE FUNCTION mellu_queue_count() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 INSERT INTO inventory_sheets_outbox(count_id,payload)
 SELECT NEW.id,jsonb_build_object(
  'countId',NEW.id::text,'createdAt',NEW.created_at,'ean',p.ean,'code',p.code,
  'name',p.name,'manufacturer',p.manufacturer,'packageSize',p.package_size,
  'quantity',NEW.quantity,'location',NEW.location,'baseline',p.baseline_qty,
  'physicalTotal',(SELECT COALESCE(SUM(delta),0) FROM inventory_counts WHERE product_code=NEW.product_code),
  'expiry',p.expiry_date,'kind',NEW.kind,'operator',NEW.operator_name,
  'delta',NEW.delta,'correctedCountId',NEW.corrected_count_id::text)
 FROM inventory_products p WHERE p.code=NEW.product_code;
 RETURN NEW;
END $$;
CREATE TRIGGER mellu_count_to_sheets AFTER INSERT ON inventory_counts FOR EACH ROW EXECUTE FUNCTION mellu_queue_count();
-- Queue previous DB events too, without changing or re-counting them.
INSERT INTO inventory_sheets_outbox(count_id,payload)
 SELECT c.id,jsonb_build_object(
  'countId',c.id::text,'createdAt',c.created_at,'ean',p.ean,'code',p.code,
  'name',p.name,'manufacturer',p.manufacturer,'packageSize',p.package_size,
  'quantity',c.quantity,'location',c.location,'baseline',p.baseline_qty,
  'physicalTotal',SUM(c.delta) OVER(PARTITION BY c.product_code ORDER BY c.id),
  'expiry',p.expiry_date,'kind',c.kind,'operator',c.operator_name,
  'delta',c.delta,'correctedCountId',c.corrected_count_id::text)
 FROM inventory_counts c JOIN inventory_products p ON p.code=c.product_code
 ON CONFLICT(count_id) DO NOTHING;
