CREATE TABLE IF NOT EXISTS inventory_products (
 code TEXT PRIMARY KEY,
 name TEXT NOT NULL,
 unit TEXT NOT NULL DEFAULT 'UN',
 baseline_qty NUMERIC(14,3) NOT NULL,
 current_qty NUMERIC(14,3) NOT NULL,
 sale_price NUMERIC(14,2) NOT NULL DEFAULT 0,
 ean TEXT UNIQUE,
 updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS inventory_adjustments (
 id BIGSERIAL PRIMARY KEY,
 product_code TEXT NOT NULL REFERENCES inventory_products(code),
 ean_at_time TEXT,
 product_name TEXT NOT NULL,
 previous_qty NUMERIC(14,3) NOT NULL,
 new_qty NUMERIC(14,3) NOT NULL,
 difference NUMERIC(14,3) NOT NULL,
 operator_name TEXT NOT NULL,
 reason TEXT NOT NULL DEFAULT '',
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_inventory_products_search ON inventory_products (LOWER(name));
CREATE INDEX IF NOT EXISTS idx_inventory_adjustments_date ON inventory_adjustments (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_inventory_adjustments_product ON inventory_adjustments (product_code);
