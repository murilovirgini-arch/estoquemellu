ALTER TABLE inventory_products ADD COLUMN IF NOT EXISTS manufacturer TEXT NOT NULL DEFAULT '';
ALTER TABLE inventory_products ADD COLUMN IF NOT EXISTS package_size TEXT NOT NULL DEFAULT '';
ALTER TABLE inventory_products ADD COLUMN IF NOT EXISTS expiry_date DATE;
ALTER TABLE inventory_products ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'initial';
CREATE TABLE IF NOT EXISTS inventory_catalog_events (
 id BIGSERIAL PRIMARY KEY,
 product_code TEXT NOT NULL REFERENCES inventory_products(code),
 event_type TEXT NOT NULL,
 barcode TEXT,
 name TEXT NOT NULL,
 manufacturer TEXT NOT NULL DEFAULT '',
 package_size TEXT NOT NULL DEFAULT '',
 expiry_date DATE,
 operator_name TEXT NOT NULL,
 details TEXT NOT NULL DEFAULT '',
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_inventory_catalog_events_created ON inventory_catalog_events(created_at DESC);
