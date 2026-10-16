CREATE TABLE IF NOT EXISTS inventory_counts (
 id BIGSERIAL PRIMARY KEY,
 product_code TEXT NOT NULL REFERENCES inventory_products(code),
 location TEXT NOT NULL,
 quantity NUMERIC(14,3) NOT NULL,
 delta NUMERIC(14,3) NOT NULL,
 kind TEXT NOT NULL CHECK (kind IN ('count','correction')),
 corrected_count_id BIGINT REFERENCES inventory_counts(id),
 previous_entry_qty NUMERIC(14,3),
 operator_name TEXT NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_inventory_counts_product ON inventory_counts(product_code, id DESC);
CREATE INDEX IF NOT EXISTS idx_inventory_counts_created ON inventory_counts(created_at DESC);
