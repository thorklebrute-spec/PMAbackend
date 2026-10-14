-- Account deletion jobs and blocker cleanup.
-- Do not run this from the app. Apply it manually in the Supabase SQL editor
-- before the new delete-account code is deployed.
-- This file does not contain credentials.

CREATE TABLE IF NOT EXISTS public.deletion_jobs (
  user_id uuid PRIMARY KEY,
  receipt_hash text NOT NULL UNIQUE,
  claim_token uuid,
  claimed_at timestamptz,
  state text NOT NULL CHECK (state IN ('in_progress', 'blocked', 'completed')),
  stripe_status text NOT NULL DEFAULT 'unknown'
    CHECK (stripe_status IN ('unknown', 'not_required', 'settled', 'pending')),
  storage_status text NOT NULL DEFAULT 'not_required'
    CHECK (storage_status IN ('not_required', 'pending', 'settled')),
  stripe_customer_id text,
  storage_prefix text,
  last_error text,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_deletion_jobs_storage_pending
  ON public.deletion_jobs (storage_status)
  WHERE storage_status = 'pending';

ALTER TABLE public.deletion_jobs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.deletion_jobs FROM PUBLIC;
REVOKE ALL ON TABLE public.deletion_jobs FROM anon;
REVOKE ALL ON TABLE public.deletion_jobs FROM authenticated;
GRANT ALL ON TABLE public.deletion_jobs TO service_role;

-- Mirrors applyClaim in src/services/deletionRules.js.
-- SELECT FOR UPDATE makes overlapping claims run one at a time.
-- A completed job is terminal. Receipt ownership never changes because a
-- lease or status receipt expired.
CREATE OR REPLACE FUNCTION public.claim_deletion_job(
  p_user_id uuid,
  p_receipt_hash text,
  p_storage_prefix text,
  p_stripe_customer_id text,
  p_stale_seconds integer
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  existing public.deletion_jobs%ROWTYPE;
  new_token uuid := pg_catalog.gen_random_uuid();
  fresh boolean;
  same_receipt boolean;
BEGIN
  IF p_stale_seconds IS NULL OR p_stale_seconds < 60 OR p_stale_seconds > 600 THEN
    RAISE EXCEPTION 'invalid stale lease duration'
      USING ERRCODE = '22023';
  END IF;

  -- Another account already owns this receipt. Return a reason only.
  -- Do not select or return that account's user id.
  IF EXISTS (
    SELECT 1
    FROM public.deletion_jobs
    WHERE receipt_hash = p_receipt_hash
      AND user_id <> p_user_id
  ) THEN
    RETURN pg_catalog.jsonb_build_object(
      'claimed', false,
      'reason', 'receipt_in_use',
      'claim_token', NULL,
      'state', NULL
    );
  END IF;

  BEGIN
    INSERT INTO public.deletion_jobs (
      user_id, receipt_hash, claim_token, claimed_at, state,
      stripe_status, storage_status, stripe_customer_id, storage_prefix, expires_at
    ) VALUES (
      p_user_id, p_receipt_hash, new_token, pg_catalog.now(), 'in_progress',
      'unknown', 'not_required', p_stripe_customer_id, p_storage_prefix,
      pg_catalog.now() + interval '24 hours'
    )
    ON CONFLICT (user_id) DO NOTHING;
  EXCEPTION
    WHEN unique_violation THEN
      RETURN pg_catalog.jsonb_build_object(
        'claimed', false,
        'reason', 'receipt_in_use',
        'claim_token', NULL,
        'state', NULL
      );
  END;

  SELECT * INTO existing
  FROM public.deletion_jobs
  WHERE user_id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'deletion job missing after insert';
  END IF;

  IF existing.claim_token = new_token THEN
    RETURN pg_catalog.jsonb_build_object(
      'claimed', true,
      'reason', 'created',
      'claim_token', new_token,
      'state', 'in_progress'
    );
  END IF;

  same_receipt := existing.receipt_hash = p_receipt_hash;

  IF existing.state = 'completed' THEN
    IF same_receipt THEN
      RETURN pg_catalog.jsonb_build_object(
        'claimed', false,
        'reason', 'already_completed',
        'claim_token', NULL,
        'state', 'completed'
      );
    END IF;
    RETURN pg_catalog.jsonb_build_object(
      'claimed', false,
      'reason', 'receipt_mismatch',
      'claim_token', NULL,
      'state', 'completed'
    );
  END IF;

  IF NOT same_receipt THEN
    RETURN pg_catalog.jsonb_build_object(
      'claimed', false,
      'reason', 'receipt_mismatch',
      'claim_token', NULL,
      'state', existing.state
    );
  END IF;

  fresh := existing.claimed_at IS NOT NULL
    AND existing.claimed_at > pg_catalog.now() - pg_catalog.make_interval(secs => p_stale_seconds);

  IF existing.state = 'in_progress' AND fresh THEN
    RETURN pg_catalog.jsonb_build_object(
      'claimed', false,
      'reason', 'in_progress',
      'claim_token', NULL,
      'state', 'in_progress'
    );
  END IF;

  UPDATE public.deletion_jobs
  SET claim_token = new_token,
      claimed_at = pg_catalog.now(),
      state = 'in_progress',
      storage_prefix = p_storage_prefix,
      stripe_customer_id = COALESCE(p_stripe_customer_id, stripe_customer_id),
      last_error = NULL,
      expires_at = pg_catalog.now() + interval '24 hours',
      updated_at = pg_catalog.now()
  WHERE user_id = p_user_id;

  RETURN pg_catalog.jsonb_build_object(
    'claimed', true,
    'reason', 'reclaimed',
    'claim_token', new_token,
    'state', 'in_progress'
  );
END;
$$;

-- One transaction for the rows that block auth.users deletion.
-- Does not touch user_profiles. Zero rows is success.
CREATE OR REPLACE FUNCTION public.delete_account_blockers(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
  DELETE FROM public.lifestyle_scores WHERE user_id = p_user_id;
  DELETE FROM public.onboarding_questions WHERE user_id = p_user_id;
  DELETE FROM public.users WHERE id = p_user_id;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_deletion_job(uuid, text, text, text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_deletion_job(uuid, text, text, text, integer) FROM anon;
REVOKE ALL ON FUNCTION public.claim_deletion_job(uuid, text, text, text, integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.claim_deletion_job(uuid, text, text, text, integer) TO service_role;

REVOKE ALL ON FUNCTION public.delete_account_blockers(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.delete_account_blockers(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.delete_account_blockers(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.delete_account_blockers(uuid) TO service_role;
