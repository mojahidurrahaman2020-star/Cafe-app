-- CreateEnum
CREATE TYPE "Dimension" AS ENUM ('MASS', 'VOLUME', 'COUNT');

-- CreateEnum
CREATE TYPE "StockMode" AS ENUM ('BATCH', 'MADE_TO_ORDER', 'RESALE', 'UNTRACKED');

-- CreateEnum
CREATE TYPE "IngredientMovementType" AS ENUM ('OPENING', 'RECEIVE', 'PRODUCTION_CONSUME', 'SALE_CONSUME', 'SALE_REVERSAL', 'WASTE', 'SPOILAGE', 'ADJUSTMENT', 'COUNT');

-- CreateEnum
CREATE TYPE "FinishedMovementType" AS ENUM ('OPENING', 'PRODUCED', 'RECEIVE', 'SOLD', 'SALE_REVERSAL', 'WASTE', 'SPOILAGE', 'ADJUSTMENT', 'COUNT');

-- CreateTable
CREATE TABLE "suppliers" (
    "id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "normalized_name" VARCHAR(100) NOT NULL,
    "phone" VARCHAR(40) NOT NULL DEFAULT '',
    "address" VARCHAR(300) NOT NULL DEFAULT '',
    "notes" VARCHAR(500) NOT NULL DEFAULT '',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "suppliers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ingredients" (
    "id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "normalized_name" VARCHAR(100) NOT NULL,
    "dimension" "Dimension" NOT NULL,
    "display_unit" VARCHAR(10) NOT NULL,
    "on_hand" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "avg_cost_minor" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "min_level" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "supplier_id" UUID,
    "is_packaging" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "notes" VARCHAR(500) NOT NULL DEFAULT '',
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ingredients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_movements" (
    "id" UUID NOT NULL,
    "seq" BIGSERIAL NOT NULL,
    "ingredient_id" UUID NOT NULL,
    "type" "IngredientMovementType" NOT NULL,
    "qty_delta" DECIMAL(14,3) NOT NULL,
    "unit_cost_minor" DECIMAL(14,4) NOT NULL,
    "value_minor" BIGINT NOT NULL,
    "balance_after" DECIMAL(14,3) NOT NULL,
    "ref_type" VARCHAR(40),
    "ref_id" VARCHAR(64),
    "reason" VARCHAR(300),
    "supplier_id" UUID,
    "request_id" VARCHAR(64),
    "actor_id" UUID,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "products" (
    "id" UUID NOT NULL,
    "category_id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "normalized_name" VARCHAR(100) NOT NULL,
    "description" VARCHAR(300) NOT NULL DEFAULT '',
    "price_minor" INTEGER NOT NULL,
    "station_override" "PrepStation",
    "stock_mode" "StockMode" NOT NULL,
    "is_available" BOOLEAN NOT NULL DEFAULT true,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "recipe_yield" INTEGER NOT NULL DEFAULT 1,
    "manual_cost_minor" INTEGER,
    "portions_on_hand" INTEGER NOT NULL DEFAULT 0,
    "portion_cost_minor" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "has_image" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_images" (
    "product_id" UUID NOT NULL,
    "mime_type" VARCHAR(40) NOT NULL,
    "data" BYTEA NOT NULL,
    "etag" VARCHAR(64) NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "product_images_pkey" PRIMARY KEY ("product_id")
);

-- CreateTable
CREATE TABLE "recipe_lines" (
    "id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "ingredient_id" UUID NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL,
    "wastage_pct" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "recipe_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "modifier_groups" (
    "id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "name" VARCHAR(60) NOT NULL,
    "min_select" INTEGER NOT NULL DEFAULT 0,
    "max_select" INTEGER NOT NULL DEFAULT 1,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "modifier_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "modifiers" (
    "id" UUID NOT NULL,
    "group_id" UUID NOT NULL,
    "name" VARCHAR(60) NOT NULL,
    "price_delta_minor" INTEGER NOT NULL DEFAULT 0,
    "ingredient_id" UUID,
    "quantity" DECIMAL(14,3),
    "is_available" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "modifiers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "finished_movements" (
    "id" UUID NOT NULL,
    "seq" BIGSERIAL NOT NULL,
    "product_id" UUID NOT NULL,
    "type" "FinishedMovementType" NOT NULL,
    "qty_delta" INTEGER NOT NULL,
    "unit_cost_minor" DECIMAL(14,4) NOT NULL,
    "value_minor" BIGINT NOT NULL,
    "balance_after" INTEGER NOT NULL,
    "ref_type" VARCHAR(40),
    "ref_id" VARCHAR(64),
    "reason" VARCHAR(300),
    "request_id" VARCHAR(64),
    "actor_id" UUID,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "finished_movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "production_batches" (
    "id" UUID NOT NULL,
    "batch_no" SERIAL NOT NULL,
    "product_id" UUID NOT NULL,
    "portions" INTEGER NOT NULL,
    "consumption" JSONB NOT NULL,
    "total_cost_minor" BIGINT NOT NULL,
    "unit_cost_minor" DECIMAL(14,4) NOT NULL,
    "notes" VARCHAR(300) NOT NULL DEFAULT '',
    "request_id" VARCHAR(64) NOT NULL,
    "prepared_by_id" UUID,
    "prepared_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "production_batches_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "suppliers_normalized_name_key" ON "suppliers"("normalized_name");

-- CreateIndex
CREATE UNIQUE INDEX "ingredients_normalized_name_key" ON "ingredients"("normalized_name");

-- CreateIndex
CREATE UNIQUE INDEX "stock_movements_seq_key" ON "stock_movements"("seq");

-- CreateIndex
CREATE UNIQUE INDEX "stock_movements_request_id_key" ON "stock_movements"("request_id");

-- CreateIndex
CREATE INDEX "stock_movements_ingredient_id_occurred_at_idx" ON "stock_movements"("ingredient_id", "occurred_at");

-- CreateIndex
CREATE INDEX "stock_movements_occurred_at_idx" ON "stock_movements"("occurred_at");

-- CreateIndex
CREATE INDEX "stock_movements_ref_type_ref_id_idx" ON "stock_movements"("ref_type", "ref_id");

-- CreateIndex
CREATE UNIQUE INDEX "products_normalized_name_key" ON "products"("normalized_name");

-- CreateIndex
CREATE INDEX "products_category_id_sort_order_idx" ON "products"("category_id", "sort_order");

-- CreateIndex
CREATE UNIQUE INDEX "recipe_lines_product_id_ingredient_id_key" ON "recipe_lines"("product_id", "ingredient_id");

-- CreateIndex
CREATE UNIQUE INDEX "finished_movements_seq_key" ON "finished_movements"("seq");

-- CreateIndex
CREATE UNIQUE INDEX "finished_movements_request_id_key" ON "finished_movements"("request_id");

-- CreateIndex
CREATE INDEX "finished_movements_product_id_occurred_at_idx" ON "finished_movements"("product_id", "occurred_at");

-- CreateIndex
CREATE INDEX "finished_movements_occurred_at_idx" ON "finished_movements"("occurred_at");

-- CreateIndex
CREATE INDEX "finished_movements_ref_type_ref_id_idx" ON "finished_movements"("ref_type", "ref_id");

-- CreateIndex
CREATE UNIQUE INDEX "production_batches_batch_no_key" ON "production_batches"("batch_no");

-- CreateIndex
CREATE UNIQUE INDEX "production_batches_request_id_key" ON "production_batches"("request_id");

-- CreateIndex
CREATE INDEX "production_batches_product_id_prepared_at_idx" ON "production_batches"("product_id", "prepared_at");

-- CreateIndex
CREATE INDEX "production_batches_prepared_at_idx" ON "production_batches"("prepared_at");

-- AddForeignKey
ALTER TABLE "ingredients" ADD CONSTRAINT "ingredients_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_ingredient_id_fkey" FOREIGN KEY ("ingredient_id") REFERENCES "ingredients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "menu_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_images" ADD CONSTRAINT "product_images_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recipe_lines" ADD CONSTRAINT "recipe_lines_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recipe_lines" ADD CONSTRAINT "recipe_lines_ingredient_id_fkey" FOREIGN KEY ("ingredient_id") REFERENCES "ingredients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "modifier_groups" ADD CONSTRAINT "modifier_groups_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "modifiers" ADD CONSTRAINT "modifiers_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "modifier_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "modifiers" ADD CONSTRAINT "modifiers_ingredient_id_fkey" FOREIGN KEY ("ingredient_id") REFERENCES "ingredients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finished_movements" ADD CONSTRAINT "finished_movements_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_batches" ADD CONSTRAINT "production_batches_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ───────────── Integrity guards (hand-written) ─────────────
ALTER TABLE "ingredients"
  ADD CONSTRAINT "ingredients_on_hand_nonneg" CHECK ("on_hand" >= 0),
  ADD CONSTRAINT "ingredients_min_level_nonneg" CHECK ("min_level" >= 0),
  ADD CONSTRAINT "ingredients_avg_cost_nonneg" CHECK ("avg_cost_minor" >= 0),
  ADD CONSTRAINT "ingredients_display_unit" CHECK (
    ("dimension" = 'MASS'   AND "display_unit" IN ('g','kg')) OR
    ("dimension" = 'VOLUME' AND "display_unit" IN ('ml','l')) OR
    ("dimension" = 'COUNT'  AND "display_unit" IN ('pcs','dozen')));

ALTER TABLE "products"
  ADD CONSTRAINT "products_price_nonneg" CHECK ("price_minor" >= 0),
  ADD CONSTRAINT "products_portions_nonneg" CHECK ("portions_on_hand" >= 0),
  ADD CONSTRAINT "products_portion_cost_nonneg" CHECK ("portion_cost_minor" >= 0),
  ADD CONSTRAINT "products_recipe_yield" CHECK ("recipe_yield" BETWEEN 1 AND 10000),
  ADD CONSTRAINT "products_manual_cost_nonneg" CHECK ("manual_cost_minor" IS NULL OR "manual_cost_minor" >= 0);

ALTER TABLE "recipe_lines"
  ADD CONSTRAINT "recipe_lines_qty_pos" CHECK ("quantity" > 0),
  ADD CONSTRAINT "recipe_lines_wastage" CHECK ("wastage_pct" >= 0 AND "wastage_pct" < 100);

ALTER TABLE "modifier_groups"
  ADD CONSTRAINT "modifier_groups_select" CHECK ("min_select" >= 0 AND "max_select" >= 1 AND "min_select" <= "max_select");

ALTER TABLE "modifiers"
  ADD CONSTRAINT "modifiers_ingredient_qty" CHECK (("ingredient_id" IS NULL) = ("quantity" IS NULL) AND ("quantity" IS NULL OR "quantity" > 0));

ALTER TABLE "stock_movements"
  ADD CONSTRAINT "stock_movements_balance_nonneg" CHECK ("balance_after" >= 0),
  ADD CONSTRAINT "stock_movements_nonzero" CHECK ("qty_delta" <> 0 OR "type" = 'COUNT');

ALTER TABLE "finished_movements"
  ADD CONSTRAINT "finished_movements_balance_nonneg" CHECK ("balance_after" >= 0),
  ADD CONSTRAINT "finished_movements_nonzero" CHECK ("qty_delta" <> 0 OR "type" = 'COUNT');

ALTER TABLE "production_batches"
  ADD CONSTRAINT "production_batches_portions_pos" CHECK ("portions" > 0);

-- Ledgers and batch records are append-only: corrections are new movements, never edits.
CREATE OR REPLACE FUNCTION forbid_ledger_change() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% is append-only (% blocked)', TG_TABLE_NAME, TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER stock_movements_append_only BEFORE UPDATE OR DELETE ON "stock_movements"
  FOR EACH ROW EXECUTE FUNCTION forbid_ledger_change();
CREATE TRIGGER finished_movements_append_only BEFORE UPDATE OR DELETE ON "finished_movements"
  FOR EACH ROW EXECUTE FUNCTION forbid_ledger_change();
CREATE TRIGGER production_batches_append_only BEFORE UPDATE OR DELETE ON "production_batches"
  FOR EACH ROW EXECUTE FUNCTION forbid_ledger_change();
