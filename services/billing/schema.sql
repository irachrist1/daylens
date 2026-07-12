CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS billing_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  installation_hash TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  free_credit_granted_micros BIGINT NOT NULL DEFAULT 5000000,
  free_credit_remaining_micros BIGINT NOT NULL DEFAULT 5000000,
  plan TEXT NOT NULL DEFAULT 'free' CHECK (plan IN ('free', 'subscription', 'local_pass')),
  subscription_status TEXT,
  period_started_at TIMESTAMPTZ,
  renewal_at TIMESTAMPTZ,
  local_pass_expires_at TIMESTAMPTZ,
  polar_customer_id TEXT,
  polar_subscription_id TEXT,
  polar_event_occurred_at TIMESTAMPTZ,
  polar_event_rank INTEGER NOT NULL DEFAULT 0,
  customer_email TEXT,
  installation_token_version INTEGER NOT NULL DEFAULT 1,
  tokens_revoked_at TIMESTAMPTZ,
  spend_reserved_micros BIGINT NOT NULL DEFAULT 0,
  spend_reserved_until TIMESTAMPTZ,
  litellm_budget_mode TEXT NOT NULL DEFAULT 'free_credit',
  litellm_budget_sync_required BOOLEAN NOT NULL DEFAULT false,
  litellm_key_cipher TEXT NOT NULL
);

ALTER TABLE billing_accounts ADD COLUMN IF NOT EXISTS polar_event_occurred_at TIMESTAMPTZ;
ALTER TABLE billing_accounts ADD COLUMN IF NOT EXISTS polar_event_rank INTEGER NOT NULL DEFAULT 0;
ALTER TABLE billing_accounts ADD COLUMN IF NOT EXISTS installation_token_version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE billing_accounts ADD COLUMN IF NOT EXISTS tokens_revoked_at TIMESTAMPTZ;
ALTER TABLE billing_accounts ADD COLUMN IF NOT EXISTS spend_reserved_micros BIGINT NOT NULL DEFAULT 0;
ALTER TABLE billing_accounts ADD COLUMN IF NOT EXISTS spend_reserved_until TIMESTAMPTZ;
ALTER TABLE billing_accounts ADD COLUMN IF NOT EXISTS litellm_budget_mode TEXT NOT NULL DEFAULT 'free_credit';
ALTER TABLE billing_accounts ADD COLUMN IF NOT EXISTS litellm_budget_sync_required BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS billing_usage (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES billing_accounts(id) ON DELETE CASCADE,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  mode TEXT NOT NULL CHECK (mode IN ('free_credit', 'subscription', 'local_pass')),
  feature TEXT NOT NULL,
  provider TEXT,
  model TEXT,
  input_tokens BIGINT,
  output_tokens BIGINT,
  cost_micros BIGINT NOT NULL,
  success BOOLEAN NOT NULL DEFAULT true,
  request_id TEXT
);

CREATE INDEX IF NOT EXISTS billing_usage_account_time
  ON billing_usage (account_id, occurred_at DESC);

CREATE TABLE IF NOT EXISTS billing_payment_events (
  provider TEXT NOT NULL,
  event_id TEXT NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at TIMESTAMPTZ,
  last_error TEXT,
  PRIMARY KEY (provider, event_id)
);

CREATE TABLE IF NOT EXISTS billing_polar_subscriptions (
  subscription_id TEXT PRIMARY KEY,
  account_id UUID NOT NULL REFERENCES billing_accounts(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  event_occurred_at TIMESTAMPTZ NOT NULL,
  event_rank INTEGER NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS billing_polar_subscriptions_account
  ON billing_polar_subscriptions (account_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS billing_payment_intents (
  provider TEXT NOT NULL,
  tx_ref TEXT NOT NULL,
  account_id UUID NOT NULL REFERENCES billing_accounts(id) ON DELETE CASCADE,
  amount INTEGER NOT NULL,
  currency TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  provider_reference TEXT,
  checkout_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (provider, tx_ref)
);

CREATE INDEX IF NOT EXISTS billing_payment_intents_account_time
  ON billing_payment_intents (account_id, created_at DESC);

CREATE TABLE IF NOT EXISTS billing_bootstrap_attempts (
  ip_hash TEXT NOT NULL,
  attempted_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS billing_bootstrap_attempts_ip_time
  ON billing_bootstrap_attempts (ip_hash, attempted_at DESC);
