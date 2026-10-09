-- V2 reset (approved: no V1 data is preserved). Drop children before parents.
-- No CASCADE: if anything unexpected depends on these tables, fail instead of silently dropping it.
DROP TABLE IF EXISTS "transactions";
--> statement-breakpoint
DROP TABLE IF EXISTS "budgets";
--> statement-breakpoint
DROP TABLE IF EXISTS "accounts";
--> statement-breakpoint
DROP TABLE IF EXISTS "categories";
--> statement-breakpoint
DROP TABLE IF EXISTS "bank_connections";
--> statement-breakpoint
DROP TABLE IF EXISTS "connected_banks";
--> statement-breakpoint
DROP TABLE IF EXISTS "subscriptions";
--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"currency_code" char(3) DEFAULT 'USD' NOT NULL,
	"bank_connection_id" text,
	"plaid_account_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "accounts_bank_connection_id_plaid_account_id_unique" UNIQUE("bank_connection_id","plaid_account_id")
);
--> statement-breakpoint
CREATE TABLE "bank_connections" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"plaid_item_id" text NOT NULL,
	"access_token" text NOT NULL,
	"institution_id" text,
	"institution_name" text,
	"sync_cursor" text,
	"last_synced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bank_connections_user_id_unique" UNIQUE("user_id"),
	CONSTRAINT "bank_connections_plaid_item_id_unique" UNIQUE("plaid_item_id")
);
--> statement-breakpoint
CREATE TABLE "budgets" (
	"id" text PRIMARY KEY NOT NULL,
	"category_id" text NOT NULL,
	"month" date NOT NULL,
	"amount_cents" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "budgets_category_id_month_unique" UNIQUE("category_id","month")
);
--> statement-breakpoint
CREATE TABLE "categories" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"plaid_category" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "categories_user_id_plaid_category_unique" UNIQUE("user_id","plaid_category")
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"subscription_id" text NOT NULL,
	"status" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subscriptions_user_id_unique" UNIQUE("user_id"),
	CONSTRAINT "subscriptions_subscription_id_unique" UNIQUE("subscription_id")
);
--> statement-breakpoint
CREATE TABLE "transactions" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"category_id" text,
	"amount_cents" integer NOT NULL,
	"transaction_date" date NOT NULL,
	"payee" text NOT NULL,
	"notes" text,
	"plaid_transaction_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "transactions_account_id_plaid_transaction_id_unique" UNIQUE("account_id","plaid_transaction_id")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "accounts" ADD CONSTRAINT "accounts_bank_connection_id_bank_connections_id_fk" FOREIGN KEY ("bank_connection_id") REFERENCES "public"."bank_connections"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "budgets" ADD CONSTRAINT "budgets_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "transactions" ADD CONSTRAINT "transactions_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "transactions" ADD CONSTRAINT "transactions_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX "accounts_user_id_idx" ON "accounts" ("user_id");