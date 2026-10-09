-- CreateTable
CREATE TABLE "sessions" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "is_online" BOOLEAN NOT NULL DEFAULT false,
    "scope" TEXT,
    "expires" TIMESTAMP(3),
    "access_token" TEXT,
    "user_id" BIGINT,
    "first_name" TEXT,
    "last_name" TEXT,
    "email" TEXT,
    "account_owner" BOOLEAN NOT NULL DEFAULT false,
    "locale" TEXT,
    "collaborator" BOOLEAN DEFAULT false,
    "email_verified" BOOLEAN DEFAULT false,
    "refresh_token" TEXT,
    "refresh_token_expires" TIMESTAMP(3),

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shops" (
    "id" TEXT NOT NULL,
    "shop_domain" TEXT NOT NULL,
    "access_token" TEXT NOT NULL,
    "plan" TEXT NOT NULL DEFAULT 'free',
    "billing_status" TEXT NOT NULL DEFAULT 'inactive',
    "uninstalled_at" TIMESTAMP(3),
    "erasure_started_at" TIMESTAMP(3),
    "storage_provider" TEXT NOT NULL DEFAULT 'local',
    "storage_config_json" JSONB,
    "settings_json" JSONB,
    "onboarding_completed" BOOLEAN NOT NULL DEFAULT false,
    "onboarding_step" INTEGER NOT NULL DEFAULT 0,
    "onboarding_data_json" JSONB,
    "installed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shops_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "products_config" (
    "id" TEXT NOT NULL,
    "shop_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "upload_enabled" BOOLEAN NOT NULL DEFAULT true,
    "extra_questions_json" JSONB,
    "tshirt_enabled" BOOLEAN NOT NULL DEFAULT false,
    "tshirt_config_json" JSONB,
    "mode" TEXT NOT NULL DEFAULT 'dtf',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "asset_set_id" TEXT,
    "policy_overrides_json" JSONB,
    "builder_config_json" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "products_config_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "asset_sets" (
    "id" TEXT NOT NULL,
    "shop_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "schema_json" JSONB NOT NULL,
    "thumbnail_url" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "asset_sets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "uploads" (
    "id" TEXT NOT NULL,
    "shop_id" TEXT NOT NULL,
    "product_id" TEXT,
    "variant_id" TEXT,
    "order_id" TEXT,
    "mode" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "customer_id" TEXT,
    "customer_email" TEXT,
    "preflight_summary_json" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "approved_at" TIMESTAMP(3),
    "rejected_at" TIMESTAMP(3),
    "cart_added_at" TIMESTAMP(3),
    "cart_token" TEXT,
    "quantity_semantics" TEXT,
    "requested_copies" INTEGER,
    "designs_per_sheet" INTEGER,
    "sheets_needed" INTEGER,
    "cart_variant_id" TEXT,
    "cart_sheet_label" TEXT,
    "order_name" TEXT,
    "order_paid_at" TIMESTAMP(3),
    "order_total" DECIMAL(10,2),
    "order_currency" TEXT,

    CONSTRAINT "uploads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "upload_items" (
    "id" TEXT NOT NULL,
    "upload_id" TEXT NOT NULL,
    "location" TEXT NOT NULL,
    "storage_key" TEXT NOT NULL,
    "preview_key" TEXT,
    "thumbnail_key" TEXT,
    "original_name" TEXT,
    "mime_type" TEXT,
    "file_size" INTEGER,
    "upload_duration_ms" INTEGER,
    "fingerprint" TEXT,
    "transform_json" JSONB,
    "preflight_status" TEXT NOT NULL DEFAULT 'pending',
    "preflight_result_json" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "upload_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "orders_link" (
    "id" TEXT NOT NULL,
    "shop_id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "upload_id" TEXT NOT NULL,
    "line_item_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "orders_link_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "export_jobs" (
    "id" TEXT NOT NULL,
    "shop_id" TEXT NOT NULL,
    "upload_ids" TEXT[],
    "status" TEXT NOT NULL DEFAULT 'pending',
    "download_url" TEXT,
    "expires_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "export_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "shop_id" TEXT NOT NULL,
    "user_id" TEXT,
    "action" TEXT NOT NULL,
    "resource_type" TEXT NOT NULL,
    "resource_id" TEXT,
    "metadata_json" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "team_members" (
    "id" TEXT NOT NULL,
    "shop_id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "role" TEXT NOT NULL DEFAULT 'viewer',
    "invite_token" TEXT,
    "invited_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "accepted_at" TIMESTAMP(3),
    "last_login_at" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'pending',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "team_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "api_keys" (
    "id" TEXT NOT NULL,
    "shop_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "key_hash" TEXT NOT NULL,
    "key_prefix" TEXT NOT NULL,
    "permissions" TEXT[],
    "rate_limit" INTEGER NOT NULL DEFAULT 100,
    "expires_at" TIMESTAMP(3),
    "last_used_at" TIMESTAMP(3),
    "usage_count" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "api_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "white_label_config" (
    "id" TEXT NOT NULL,
    "shop_id" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "logo_url" TEXT,
    "primary_color" TEXT,
    "secondary_color" TEXT,
    "custom_css" TEXT,
    "hide_branding" BOOLEAN NOT NULL DEFAULT false,
    "custom_domain" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "white_label_config_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "flow_triggers" (
    "id" TEXT NOT NULL,
    "shop_id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "resource_id" TEXT NOT NULL,
    "payload_json" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "sent_at" TIMESTAMP(3),
    "error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "flow_triggers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "support_tickets" (
    "id" TEXT NOT NULL,
    "shop_id" TEXT NOT NULL,
    "ticket_number" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "shop_domain" TEXT,
    "category" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "priority" TEXT NOT NULL DEFAULT 'normal',
    "assigned_to" TEXT,
    "email_sent_at" TIMESTAMP(3),
    "first_reply_at" TIMESTAMP(3),
    "resolved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "support_tickets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "support_replies" (
    "id" TEXT NOT NULL,
    "ticket_id" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "is_staff" BOOLEAN NOT NULL DEFAULT false,
    "author_name" TEXT NOT NULL,
    "author_email" TEXT NOT NULL,
    "email_sent_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "support_replies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commissions" (
    "id" TEXT NOT NULL,
    "shop_id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "order_number" TEXT,
    "order_total" DECIMAL(10,2) NOT NULL,
    "order_currency" TEXT NOT NULL DEFAULT 'USD',
    "commission_rate" DECIMAL(5,4) NOT NULL DEFAULT 0.035,
    "commission_amount" DECIMAL(10,2) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "paid_at" TIMESTAMP(3),
    "payment_ref" TEXT,
    "payment_provider" TEXT,
    "billing_currency" TEXT NOT NULL DEFAULT 'USD',
    "served_amount_usd" DECIMAL(12,2),
    "fx_rate" DECIMAL(20,10),
    "fx_source" TEXT,
    "fx_observed_at" TIMESTAMP(3),
    "usage_idempotency_key" TEXT,
    "usage_line_item_id" TEXT,
    "usage_subscription_id" TEXT,
    "usage_record_id" TEXT,
    "usage_request_started_at" TIMESTAMP(3),
    "next_billing_attempt_at" TIMESTAMP(3),
    "billing_last_error" TEXT,
    "collectible_at" TIMESTAMP(3),
    "eligibility_source" TEXT,
    "attributable_captured_amount" DECIMAL(10,2),
    "shopify_financial_status" TEXT,
    "shopify_refund_status" TEXT,
    "shopify_cancelled_at" TIMESTAMP(3),
    "shopify_observed_at" TIMESTAMP(3),
    "review_required_at" TIMESTAMP(3),
    "review_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "commissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "upload_logs" (
    "id" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "level" TEXT NOT NULL,
    "trace_id" TEXT,
    "upload_id" TEXT,
    "item_id" TEXT,
    "shop_id" TEXT NOT NULL,
    "provider" TEXT,
    "context_json" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "upload_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shop_billing" (
    "id" TEXT NOT NULL,
    "shop_id" TEXT NOT NULL,
    "subscription_id" TEXT,
    "usage_line_item_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'inactive',
    "capped_amount_usd" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "balance_used_usd" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "current_period_end" TIMESTAMP(3),
    "pending_approval_url" TEXT,
    "pending_cap_usd" DECIMAL(12,2),
    "test" BOOLEAN NOT NULL DEFAULT false,
    "synced_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shop_billing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing_credits" (
    "id" TEXT NOT NULL,
    "shop_id" TEXT NOT NULL,
    "commission_id" TEXT NOT NULL,
    "amount_usd" DECIMAL(12,2) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'review',
    "provider_ref" TEXT,
    "idempotency_key" TEXT NOT NULL,
    "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "settled_at" TIMESTAMP(3),

    CONSTRAINT "billing_credits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "compliance_requests" (
    "id" TEXT NOT NULL,
    "shop_domain" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "payload" JSONB,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "due_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "result" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),
    "lease_until" TIMESTAMP(3),
    "lease_token" TEXT,

    CONSTRAINT "compliance_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sessions_shop_idx" ON "sessions"("shop");

-- CreateIndex
CREATE UNIQUE INDEX "shops_shop_domain_key" ON "shops"("shop_domain");

-- CreateIndex
CREATE UNIQUE INDEX "products_config_shop_id_product_id_key" ON "products_config"("shop_id", "product_id");

-- CreateIndex
CREATE INDEX "uploads_shop_id_status_idx" ON "uploads"("shop_id", "status");

-- CreateIndex
CREATE INDEX "uploads_shop_id_created_at_idx" ON "uploads"("shop_id", "created_at");

-- CreateIndex
CREATE INDEX "uploads_shop_id_cart_token_idx" ON "uploads"("shop_id", "cart_token");

-- CreateIndex
CREATE INDEX "uploads_order_paid_at_idx" ON "uploads"("order_paid_at");

-- CreateIndex
CREATE INDEX "upload_items_fingerprint_idx" ON "upload_items"("fingerprint");

-- CreateIndex
CREATE UNIQUE INDEX "orders_link_shop_id_order_id_upload_id_key" ON "orders_link"("shop_id", "order_id", "upload_id");

-- CreateIndex
CREATE INDEX "audit_logs_shop_id_created_at_idx" ON "audit_logs"("shop_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "team_members_shop_id_email_key" ON "team_members"("shop_id", "email");

-- CreateIndex
CREATE INDEX "api_keys_key_hash_idx" ON "api_keys"("key_hash");

-- CreateIndex
CREATE UNIQUE INDEX "white_label_config_shop_id_key" ON "white_label_config"("shop_id");

-- CreateIndex
CREATE INDEX "flow_triggers_shop_id_event_type_idx" ON "flow_triggers"("shop_id", "event_type");

-- CreateIndex
CREATE UNIQUE INDEX "support_tickets_ticket_number_key" ON "support_tickets"("ticket_number");

-- CreateIndex
CREATE INDEX "support_tickets_email_idx" ON "support_tickets"("email");

-- CreateIndex
CREATE INDEX "support_tickets_status_idx" ON "support_tickets"("status");

-- CreateIndex
CREATE INDEX "support_tickets_shop_domain_idx" ON "support_tickets"("shop_domain");

-- CreateIndex
CREATE INDEX "support_tickets_shop_id_idx" ON "support_tickets"("shop_id");

-- CreateIndex
CREATE UNIQUE INDEX "commissions_usage_idempotency_key_key" ON "commissions"("usage_idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "commissions_usage_record_id_key" ON "commissions"("usage_record_id");

-- CreateIndex
CREATE INDEX "commissions_shop_id_status_idx" ON "commissions"("shop_id", "status");

-- CreateIndex
CREATE INDEX "commissions_shop_id_status_collectible_at_idx" ON "commissions"("shop_id", "status", "collectible_at");

-- CreateIndex
CREATE INDEX "commissions_shop_id_created_at_idx" ON "commissions"("shop_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "commissions_shop_id_order_id_key" ON "commissions"("shop_id", "order_id");

-- CreateIndex
CREATE INDEX "upload_logs_upload_id_idx" ON "upload_logs"("upload_id");

-- CreateIndex
CREATE INDEX "upload_logs_shop_id_created_at_idx" ON "upload_logs"("shop_id", "created_at");

-- CreateIndex
CREATE INDEX "upload_logs_event_level_idx" ON "upload_logs"("event", "level");

-- CreateIndex
CREATE INDEX "upload_logs_trace_id_idx" ON "upload_logs"("trace_id");

-- CreateIndex
CREATE INDEX "upload_logs_created_at_idx" ON "upload_logs"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "shop_billing_shop_id_key" ON "shop_billing"("shop_id");

-- CreateIndex
CREATE UNIQUE INDEX "billing_credits_idempotency_key_key" ON "billing_credits"("idempotency_key");

-- CreateIndex
CREATE INDEX "billing_credits_shop_id_status_idx" ON "billing_credits"("shop_id", "status");

-- CreateIndex
CREATE INDEX "compliance_requests_status_due_at_idx" ON "compliance_requests"("status", "due_at");

-- CreateIndex
CREATE UNIQUE INDEX "compliance_requests_shop_domain_topic_event_id_key" ON "compliance_requests"("shop_domain", "topic", "event_id");

-- AddForeignKey
ALTER TABLE "products_config" ADD CONSTRAINT "products_config_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products_config" ADD CONSTRAINT "products_config_asset_set_id_fkey" FOREIGN KEY ("asset_set_id") REFERENCES "asset_sets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_sets" ADD CONSTRAINT "asset_sets_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "uploads" ADD CONSTRAINT "uploads_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "upload_items" ADD CONSTRAINT "upload_items_upload_id_fkey" FOREIGN KEY ("upload_id") REFERENCES "uploads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders_link" ADD CONSTRAINT "orders_link_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders_link" ADD CONSTRAINT "orders_link_upload_id_fkey" FOREIGN KEY ("upload_id") REFERENCES "uploads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "export_jobs" ADD CONSTRAINT "export_jobs_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "white_label_config" ADD CONSTRAINT "white_label_config_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "flow_triggers" ADD CONSTRAINT "flow_triggers_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_replies" ADD CONSTRAINT "support_replies_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "support_tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commissions" ADD CONSTRAINT "commissions_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "upload_logs" ADD CONSTRAINT "upload_logs_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shop_billing" ADD CONSTRAINT "shop_billing_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing_credits" ADD CONSTRAINT "billing_credits_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE ON UPDATE CASCADE;
