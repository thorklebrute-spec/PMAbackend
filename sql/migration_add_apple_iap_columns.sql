-- Migration: Apple IAP billing columns on user_profiles
-- Keep existing Stripe columns; Apple and Stripe can coexist per user over time.

ALTER TABLE user_profiles
ADD COLUMN IF NOT EXISTS billing_provider TEXT,
ADD COLUMN IF NOT EXISTS apple_original_transaction_id TEXT,
ADD COLUMN IF NOT EXISTS apple_transaction_id TEXT,
ADD COLUMN IF NOT EXISTS apple_product_id TEXT,
ADD COLUMN IF NOT EXISTS apple_expires_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS apple_environment TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_profiles_apple_original_transaction_id
  ON user_profiles(apple_original_transaction_id)
  WHERE apple_original_transaction_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_user_profiles_billing_provider
  ON user_profiles(billing_provider);

SELECT 'Migration: Apple IAP columns added to user_profiles successfully' AS status;
