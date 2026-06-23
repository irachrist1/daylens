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
  customer_email TEXT,
  litellm_key_cipher TEXT NOT NULL
);

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
  PRIMARY KEY (provider, event_id)
);

CREATE TABLE IF NOT EXISTS billing_bootstrap_attempts (
  ip_hash TEXT NOT NULL,
  attempted_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS billing_bootstrap_attempts_ip_time
  ON billing_bootstrap_attempts (ip_hash, attempted_at DESC);
