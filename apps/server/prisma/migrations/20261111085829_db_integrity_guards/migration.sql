-- Database-level integrity guards that Prisma's schema language cannot express.
-- These protect the data even if a future bug or a manual SQL session bypasses
-- the application's validation.

-- Business settings is a singleton row.
ALTER TABLE "business_settings"
  ADD CONSTRAINT "business_settings_singleton" CHECK ("id" = 1),
  ADD CONSTRAINT "business_settings_currency_decimals" CHECK ("currency_decimals" BETWEEN 0 AND 3),
  ADD CONSTRAINT "business_settings_day_start_hour" CHECK ("business_day_start_hour" BETWEEN 0 AND 23),
  ADD CONSTRAINT "business_settings_currency_code" CHECK ("currency_code" ~ '^[A-Z]{3}$'),
  ADD CONSTRAINT "business_settings_service_type" CHECK ("dine_in_enabled" OR "takeaway_enabled");

ALTER TABLE "menu_categories"
  ADD CONSTRAINT "menu_categories_name_not_blank" CHECK (length(btrim("name")) > 0),
  ADD CONSTRAINT "menu_categories_sort_order" CHECK ("sort_order" >= 0);

ALTER TABLE "users"
  ADD CONSTRAINT "users_username_format" CHECK ("username" ~ '^[a-z0-9._-]{3,50}$'),
  ADD CONSTRAINT "users_failed_login_count" CHECK ("failed_login_count" >= 0);

-- The audit log is append-only. Rows can be inserted but never changed or removed.
-- (Retention/archiving, if ever needed, must be done by a DBA disabling this
-- trigger deliberately, which itself is visible in the database logs.)
CREATE OR REPLACE FUNCTION audit_logs_append_only() RETURNS trigger AS $$
BEGIN
  -- Allow the FK "ON DELETE SET NULL" of actor_id when a user row is removed;
  -- every other column must remain unchanged.
  IF TG_OP = 'UPDATE'
     AND NEW."actor_id" IS NULL
     AND (NEW."id", NEW."occurred_at", NEW."action", NEW."entity_type",
          NEW."entity_id", NEW."before"::text, NEW."after"::text, NEW."ip_address", NEW."user_agent")
         IS NOT DISTINCT FROM
         (OLD."id", OLD."occurred_at", OLD."action", OLD."entity_type",
          OLD."entity_id", OLD."before"::text, OLD."after"::text, OLD."ip_address", OLD."user_agent")
  THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'audit_logs is append-only (% blocked)', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_logs_no_update
  BEFORE UPDATE OR DELETE ON "audit_logs"
  FOR EACH ROW EXECUTE FUNCTION audit_logs_append_only();
