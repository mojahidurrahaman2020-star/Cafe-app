-- CreateEnum
CREATE TYPE "ServiceType" AS ENUM ('DINE_IN', 'TAKEAWAY');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('HELD', 'OPEN', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('UNPAID', 'PARTIALLY_PAID', 'PAID', 'PARTIALLY_REFUNDED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "PrepStatus" AS ENUM ('PENDING', 'PREPARING', 'READY', 'SERVED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "LineStockState" AS ENUM ('NOT_TRACKED', 'CONSUMED', 'RESTORED', 'WASTED', 'CONFLICT');

-- CreateEnum
CREATE TYPE "PaymentKind" AS ENUM ('CASH', 'CARD', 'MOBILE', 'OTHER');

-- CreateEnum
CREATE TYPE "PrinterRole" AS ENUM ('RECEIPT', 'BARISTA', 'KITCHEN');

-- CreateEnum
CREATE TYPE "PrintJobStatus" AS ENUM ('PENDING', 'PRINTING', 'PRINTED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PrintJobKind" AS ENUM ('RECEIPT', 'TICKET', 'TEST');

-- AlterTable
ALTER TABLE "business_settings" ADD COLUMN     "table_count" INTEGER NOT NULL DEFAULT 12,
ADD COLUMN     "tax_registration" VARCHAR(100) NOT NULL DEFAULT '';

-- CreateTable
CREATE TABLE "tax_rates" (
    "id" UUID NOT NULL,
    "name" VARCHAR(60) NOT NULL,
    "rate_bp" INTEGER NOT NULL,
    "inclusive" BOOLEAN NOT NULL DEFAULT true,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "tax_rates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_methods" (
    "id" UUID NOT NULL,
    "name" VARCHAR(40) NOT NULL,
    "normalized_name" VARCHAR(40) NOT NULL,
    "kind" "PaymentKind" NOT NULL,
    "requires_reference" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "payment_methods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cash_sessions" (
    "id" UUID NOT NULL,
    "opened_by_id" UUID NOT NULL,
    "opened_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "opening_float_minor" INTEGER NOT NULL,
    "closed_by_id" UUID,
    "closed_at" TIMESTAMPTZ(3),
    "expected_cash_minor" INTEGER,
    "counted_cash_minor" INTEGER,
    "variance_minor" INTEGER,
    "notes" VARCHAR(300) NOT NULL DEFAULT '',

    CONSTRAINT "cash_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "orders" (
    "id" UUID NOT NULL,
    "order_no" INTEGER NOT NULL,
    "business_date" VARCHAR(10) NOT NULL,
    "service_type" "ServiceType" NOT NULL,
    "table_no" VARCHAR(10),
    "customer_name" VARCHAR(60) NOT NULL DEFAULT '',
    "status" "OrderStatus" NOT NULL,
    "payment_status" "PaymentStatus" NOT NULL DEFAULT 'UNPAID',
    "subtotal_minor" INTEGER NOT NULL,
    "discount_minor" INTEGER NOT NULL DEFAULT 0,
    "discount_reason" VARCHAR(120),
    "tax_minor" INTEGER NOT NULL DEFAULT 0,
    "total_minor" INTEGER NOT NULL,
    "paid_minor" INTEGER NOT NULL DEFAULT 0,
    "refunded_minor" INTEGER NOT NULL DEFAULT 0,
    "tax_snapshot" JSONB NOT NULL DEFAULT '[]',
    "notes" VARCHAR(300) NOT NULL DEFAULT '',
    "client_request_id" VARCHAR(64) NOT NULL,
    "placed_offline" BOOLEAN NOT NULL DEFAULT false,
    "offline_placed_at" TIMESTAMPTZ(3),
    "needs_review" BOOLEAN NOT NULL DEFAULT false,
    "review_note" VARCHAR(300),
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sent_at" TIMESTAMPTZ(3),
    "completed_at" TIMESTAMPTZ(3),
    "cancelled_at" TIMESTAMPTZ(3),
    "cancel_reason" VARCHAR(200),
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_lines" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "category_name" VARCHAR(60) NOT NULL,
    "unit_price_minor" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL,
    "line_total_minor" INTEGER NOT NULL,
    "modifiers" JSONB NOT NULL DEFAULT '[]',
    "notes" VARCHAR(200) NOT NULL DEFAULT '',
    "station" "PrepStation" NOT NULL,
    "prep_status" "PrepStatus" NOT NULL DEFAULT 'PENDING',
    "stock_state" "LineStockState" NOT NULL DEFAULT 'NOT_TRACKED',
    "cost_minor" INTEGER NOT NULL DEFAULT 0,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "order_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "method_id" UUID NOT NULL,
    "method_name" VARCHAR(40) NOT NULL,
    "kind" "PaymentKind" NOT NULL,
    "amount_minor" INTEGER NOT NULL,
    "tendered_minor" INTEGER,
    "change_minor" INTEGER NOT NULL DEFAULT 0,
    "reference" VARCHAR(60),
    "idempotency_key" VARCHAR(64) NOT NULL,
    "cash_session_id" UUID,
    "received_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refunds" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "method_id" UUID NOT NULL,
    "method_name" VARCHAR(40) NOT NULL,
    "kind" "PaymentKind" NOT NULL,
    "amount_minor" INTEGER NOT NULL,
    "reason" VARCHAR(200) NOT NULL,
    "idempotency_key" VARCHAR(64) NOT NULL,
    "cash_session_id" UUID,
    "approved_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refunds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "printers" (
    "id" UUID NOT NULL,
    "name" VARCHAR(60) NOT NULL,
    "role" "PrinterRole" NOT NULL,
    "host" VARCHAR(100) NOT NULL DEFAULT '',
    "port" INTEGER NOT NULL DEFAULT 9100,
    "paper_width_mm" INTEGER NOT NULL DEFAULT 80,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "cut_paper" BOOLEAN NOT NULL DEFAULT true,
    "open_drawer" BOOLEAN NOT NULL DEFAULT false,
    "status" VARCHAR(20) NOT NULL DEFAULT 'UNKNOWN',
    "last_seen_at" TIMESTAMPTZ(3),
    "last_error" VARCHAR(300),
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "printers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "print_jobs" (
    "id" UUID NOT NULL,
    "idempotency_key" VARCHAR(120) NOT NULL,
    "role" "PrinterRole" NOT NULL,
    "kind" "PrintJobKind" NOT NULL,
    "order_id" UUID,
    "payload" JSONB NOT NULL,
    "status" "PrintJobStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" VARCHAR(300),
    "reprint_no" INTEGER NOT NULL DEFAULT 0,
    "reprint_reason" VARCHAR(200),
    "requested_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "claimed_at" TIMESTAMPTZ(3),
    "printed_at" TIMESTAMPTZ(3),

    CONSTRAINT "print_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expense_categories" (
    "id" UUID NOT NULL,
    "name" VARCHAR(60) NOT NULL,
    "normalized_name" VARCHAR(60) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "expense_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expenses" (
    "id" UUID NOT NULL,
    "category_id" UUID NOT NULL,
    "amount_minor" INTEGER NOT NULL,
    "business_date" VARCHAR(10) NOT NULL,
    "paid_with" VARCHAR(40) NOT NULL DEFAULT '',
    "note" VARCHAR(300) NOT NULL DEFAULT '',
    "request_id" VARCHAR(64) NOT NULL,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "voided_at" TIMESTAMPTZ(3),
    "void_reason" VARCHAR(200),
    "voided_by_id" UUID,

    CONSTRAINT "expenses_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "payment_methods_normalized_name_key" ON "payment_methods"("normalized_name");

-- CreateIndex
CREATE INDEX "cash_sessions_opened_at_idx" ON "cash_sessions"("opened_at");

-- CreateIndex
CREATE UNIQUE INDEX "orders_client_request_id_key" ON "orders"("client_request_id");

-- CreateIndex
CREATE INDEX "orders_status_business_date_idx" ON "orders"("status", "business_date");

-- CreateIndex
CREATE INDEX "orders_created_at_idx" ON "orders"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "orders_business_date_order_no_key" ON "orders"("business_date", "order_no");

-- CreateIndex
CREATE INDEX "order_lines_order_id_idx" ON "order_lines"("order_id");

-- CreateIndex
CREATE INDEX "order_lines_station_prep_status_idx" ON "order_lines"("station", "prep_status");

-- CreateIndex
CREATE UNIQUE INDEX "payments_idempotency_key_key" ON "payments"("idempotency_key");

-- CreateIndex
CREATE INDEX "payments_order_id_idx" ON "payments"("order_id");

-- CreateIndex
CREATE INDEX "payments_created_at_idx" ON "payments"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "refunds_idempotency_key_key" ON "refunds"("idempotency_key");

-- CreateIndex
CREATE INDEX "refunds_order_id_idx" ON "refunds"("order_id");

-- CreateIndex
CREATE INDEX "refunds_created_at_idx" ON "refunds"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "printers_role_key" ON "printers"("role");

-- CreateIndex
CREATE UNIQUE INDEX "print_jobs_idempotency_key_key" ON "print_jobs"("idempotency_key");

-- CreateIndex
CREATE INDEX "print_jobs_status_created_at_idx" ON "print_jobs"("status", "created_at");

-- CreateIndex
CREATE INDEX "print_jobs_order_id_idx" ON "print_jobs"("order_id");

-- CreateIndex
CREATE UNIQUE INDEX "expense_categories_normalized_name_key" ON "expense_categories"("normalized_name");

-- CreateIndex
CREATE UNIQUE INDEX "expenses_request_id_key" ON "expenses"("request_id");

-- CreateIndex
CREATE INDEX "expenses_business_date_idx" ON "expenses"("business_date");

-- AddForeignKey
ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_method_id_fkey" FOREIGN KEY ("method_id") REFERENCES "payment_methods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_cash_session_id_fkey" FOREIGN KEY ("cash_session_id") REFERENCES "cash_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_method_id_fkey" FOREIGN KEY ("method_id") REFERENCES "payment_methods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_cash_session_id_fkey" FOREIGN KEY ("cash_session_id") REFERENCES "cash_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "print_jobs" ADD CONSTRAINT "print_jobs_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "expense_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ───────────── Integrity guards (hand-written) ─────────────
ALTER TABLE "business_settings" ADD CONSTRAINT "business_settings_table_count" CHECK ("table_count" BETWEEN 0 AND 500);
ALTER TABLE "tax_rates" ADD CONSTRAINT "tax_rates_rate" CHECK ("rate_bp" BETWEEN 0 AND 10000);
ALTER TABLE "orders"
  ADD CONSTRAINT "orders_amounts" CHECK ("subtotal_minor" >= 0 AND "discount_minor" >= 0 AND "tax_minor" >= 0 AND "total_minor" >= 0
    AND "paid_minor" >= 0 AND "refunded_minor" >= 0 AND "refunded_minor" <= "paid_minor" AND "discount_minor" <= "subtotal_minor"),
  ADD CONSTRAINT "orders_paid_not_over" CHECK ("paid_minor" <= "total_minor"),
  ADD CONSTRAINT "orders_order_no" CHECK ("order_no" > 0);
ALTER TABLE "order_lines"
  ADD CONSTRAINT "order_lines_qty" CHECK ("quantity" > 0),
  ADD CONSTRAINT "order_lines_amounts" CHECK ("unit_price_minor" >= 0 AND "line_total_minor" >= 0);
ALTER TABLE "payments"
  ADD CONSTRAINT "payments_amount" CHECK ("amount_minor" > 0 AND "change_minor" >= 0);
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_amount" CHECK ("amount_minor" > 0);
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_amount" CHECK ("amount_minor" > 0);
ALTER TABLE "cash_sessions" ADD CONSTRAINT "cash_sessions_float" CHECK ("opening_float_minor" >= 0);
ALTER TABLE "printers" ADD CONSTRAINT "printers_paper" CHECK ("paper_width_mm" IN (58, 80)),
  ADD CONSTRAINT "printers_port" CHECK ("port" BETWEEN 1 AND 65535);

-- Money records are append-only: corrections are refunds, never edits or deletions.
CREATE TRIGGER payments_append_only BEFORE UPDATE OR DELETE ON "payments"
  FOR EACH ROW EXECUTE FUNCTION forbid_ledger_change();
CREATE TRIGGER refunds_append_only BEFORE UPDATE OR DELETE ON "refunds"
  FOR EACH ROW EXECUTE FUNCTION forbid_ledger_change();

-- Only one cash drawer session may be open at a time.
CREATE UNIQUE INDEX "cash_sessions_one_open" ON "cash_sessions" ((true)) WHERE "closed_at" IS NULL;
