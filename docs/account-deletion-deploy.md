# Account deletion deployment

Do not run the migration from the app, from CI, or from this repository's scripts. Apply it once in the Supabase SQL editor, then deploy the backend. Do not put tokens or service-role keys in this document.

The local unit suite is `npm run test:account-deletion`. The disposable Postgres suite is `npm run test:account-deletion:integration`. That suite starts and deletes its own container. It does not connect to production.

## Environment

The deletion deploy needs one new web-service variable:

- `DELETION_SWEEP_TOKEN`: long random secret. Required for `POST /internal/deletion-storage-sweep`. If it is missing, the process still starts and logs a warning, and the sweep route returns 503 `sweep_not_configured`.

These existing variables must already be present. The deletion code uses the service-role client for claims, blocker cleanup, and job updates.

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `STRIPE_SECRET_KEY`
- `STRIPE_MONTHLY_PRICE_ID`
- `STRIPE_WEBHOOK_SECRET`
- `RENDER_EXTERNAL_URL`

Account deletion uses `deletionAdmin`, which is created only when `SUPABASE_SERVICE_ROLE_KEY` is set. If that variable is empty, delete, status, sweep, and the deletion lock return 503 `deletion_unconfigured`. They do not call Supabase with the anon key. Authenticated routes other than delete and sign-out also return 503 until the key is present, because the lock cannot be checked. Confirm the variable is set before deploy. Do not print its value.

`APPLE_IAP_PRODUCT_ID` is optional. The default is `com.easysahal.primalmale.pro.monthly`. Account deletion does not cancel Apple subscriptions and does not send an Apple transaction id to Stripe.

Changing a Render environment variable redeploys the service that owns it. Set `DELETION_SWEEP_TOKEN` as part of the backend deploy, not as a separate earlier change that restarts the old build unexpectedly.

## Storage scheduler

Configure this only after the new backend is live. The full route behavior is in `docs/account-deletion-ops.md`.

- Render cron schedule: `*/15 * * * *`
- Command: `curl -fsS -X POST -H "x-deletion-sweep-token: $DELETION_SWEEP_TOKEN" "$RENDER_EXTERNAL_URL/internal/deletion-storage-sweep"`
- Give the cron service the same `DELETION_SWEEP_TOKEN` as the web service.
- Set its `RENDER_EXTERNAL_URL` to the backend origin, for example `https://pmabackend-ubr2.onrender.com`.
- Success prints counts only. A failed run stays pending and is retried by the next run.

Until the cron exists, an operator must call that route. Pending profile pictures are not removed by account deletion itself.

## Release runbook

Stop at any failed checkpoint. Do not delete a real account while testing.

### Checkpoint 0 — current clients

The shipping TestFlight build posts `/auth/delete-account` without a receipt. After this backend is deployed, that request returns **426** `app_update_required` and does not delete the account. The existing app shows the server message, which tells the user to update, sign out, or contact support. A present but malformed receipt still returns 400 `invalid_receipt`.

The next iOS binary must include `frontend/lib/accountDeletion.ts`, which `frontend/app/(tabs)/settings/index.tsx` imports and calls from `performDeleteAccount`. That file is in the app source. It is not in the shipping TestFlight build. No iOS build was created or submitted in this preparation step.

When approval is given, from `frontend/`:

```text
npx eas build --platform ios --profile production
```

The production profile uses remote build numbers and `autoIncrement`. Do not run `eas submit` until that build has been checked and approved. After it is installed, a delete request body contains `receipt`.

### Checkpoint 1 — local tests

From `PMAbackend/`:

```text
npm run test:account-deletion
npm run test:account-deletion:integration
```

The integration command starts a disposable Postgres container and deletes it. It does not connect to production.

### Checkpoint 2 — read-only production catalog

Run these in the Supabase SQL editor. They only read catalogs. Do not run `migration_account_deletion.sql` in this step, and do not call `claim_deletion_job` or `delete_account_blockers`.

Foreign keys that can block `auth.users` deletion:

```sql
SELECT
  n.nspname AS schema_name,
  c.relname AS table_name,
  a.attname AS column_name,
  c.confdeltype AS delete_action
FROM pg_constraint c
JOIN pg_class t ON t.oid = c.conrelid
JOIN pg_namespace n ON n.oid = t.relnamespace
JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY (c.conkey)
WHERE c.contype = 'f'
  AND c.confrelid = 'auth.users'::regclass
ORDER BY 1, 2;
```

`confdeltype`: `a` is NO ACTION, `r` is RESTRICT, `c` is CASCADE, `n` is SET NULL. The known NO ACTION blocker is `public.users`. CASCADE app tables are removed by `auth.admin.deleteUser` and must not be deleted first.

Children of `public.users`:

```sql
SELECT
  n.nspname AS schema_name,
  t.relname AS table_name,
  a.attname AS column_name,
  c.confdeltype AS delete_action
FROM pg_constraint c
JOIN pg_class t ON t.oid = c.conrelid
JOIN pg_namespace n ON n.oid = t.relnamespace
JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY (c.conkey)
WHERE c.contype = 'f'
  AND c.confrelid = 'public.users'::regclass
ORDER BY 1, 2;
```

Expected rows: `lifestyle_scores.user_id` and `onboarding_questions.user_id`, both `a`. If another NO ACTION or RESTRICT child appears, stop. `delete_account_blockers` does not delete it.

Confirm those two tables have no children of their own:

```sql
SELECT c.confrelid::regclass AS parent_table, c.conrelid::regclass AS child_table
FROM pg_constraint c
WHERE c.contype = 'f'
  AND c.confrelid IN ('public.lifestyle_scores'::regclass, 'public.onboarding_questions'::regclass);
```

Expected: no rows.

Confirm `user_profiles` is not a target of the cleanup function by reading its Apple column, without changing a row:

```sql
SELECT column_name
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'user_profiles'
  AND column_name = 'apple_original_transaction_id';
```

Expected: one row. The cleanup function does not delete `user_profiles`.

Roles the migration grants already exist on Supabase:

```sql
SELECT rolname, rolbypassrls
FROM pg_roles
WHERE rolname IN ('anon', 'authenticated', 'service_role');
```

Expected: three rows, and `service_role` has `rolbypassrls = true`.

### Checkpoint 3 — apply the migration

Run `sql/migration_account_deletion.sql` once in the SQL editor. Then read it back:

```sql
SELECT c.relrowsecurity AS rls_enabled, c.relforcerowsecurity AS rls_forced
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relname = 'deletion_jobs';

SELECT routine_name
FROM information_schema.routines
WHERE routine_schema = 'public'
  AND routine_name IN ('claim_deletion_job', 'delete_account_blockers');

SELECT grantee, privilege_type
FROM information_schema.role_table_grants
WHERE table_schema = 'public' AND table_name = 'deletion_jobs'
ORDER BY 1, 2;

SELECT routine_name, grantee
FROM information_schema.role_routine_grants
WHERE routine_schema = 'public'
  AND routine_name IN ('claim_deletion_job', 'delete_account_blockers')
ORDER BY 1, 2;
```

Checkpoint: RLS is enabled. Both functions exist. `anon` and `authenticated` have no table privileges and no execute grant. `service_role` does. Do not insert a job for a real user.

### Checkpoint 4 — Render

On the web service, confirm these names exist. Do not copy their values into chat, git, or this document.

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `STRIPE_SECRET_KEY`
- `STRIPE_MONTHLY_PRICE_ID`
- `STRIPE_WEBHOOK_SECRET`
- `RENDER_EXTERNAL_URL`
- `DELETION_SWEEP_TOKEN` (new; set on the deploy that ships this backend)

`APPLE_IAP_PRODUCT_ID` is optional.

Deploy the backend only after checkpoints 1–3 pass. Setting `DELETION_SWEEP_TOKEN` redeploys the service, so set it with this deploy.

After deploy:

- Process log contains no warning that `SUPABASE_SERVICE_ROLE_KEY` is unset.
- `POST /internal/deletion-storage-sweep` with the wrong header returns 401.
- The same route with the real token returns 200 and only `swept`, `pending`, and `removedReceipts`.
- If the token was forgotten, the route returns 503 `sweep_not_configured` and the log says the token is unset. Stop and set it. Do not delete accounts until the sweep can run.

### Checkpoint 5 — storage cron

Create the Render cron only after checkpoint 4 returns 200.

- Schedule: `*/15 * * * *`
- Command: `curl -fsS -X POST -H "x-deletion-sweep-token: $DELETION_SWEEP_TOKEN" "$RENDER_EXTERNAL_URL/internal/deletion-storage-sweep"`
- The cron service has the same `DELETION_SWEEP_TOKEN` as the web service.
- Its `RENDER_EXTERNAL_URL` is the backend origin.
- The first cron log is HTTP 200. A later failure stays pending and the next run retries it.

Until that cron exists, an operator must call the route. Profile pictures left `pending` are not removed by the delete request itself.

### Checkpoint 6 — disposable account

Use a new TestFlight account created for this test, on the new build, not an existing customer.

- The delete confirmation says an Apple subscription is not canceled, a TestFlight subscription does not appear in Apple settings, and a Stripe subscription is canceled first.
- Delete succeeds and the app signs out.
- Turn the network off before the response returns, then reopen the app. Sign-out happens only when status is `completed`. `pending` and `unknown` stay signed in.
- In Supabase, that test user's `auth.users` row is gone. `user_profiles` is gone only because `deleteUser` cascaded it, not because the cleanup function deleted it early.
- No other user's `deletion_jobs` row changed.

## Rollback and recovery

- Before any deletion job exists, deploy the previous backend. Leave the empty `deletion_jobs` table in place. Drop it only while it has zero rows.
- If the new backend is deployed before the migration, delete returns 503 `deletion_incomplete` and the account remains. Apply the migration, then retry. Do not roll forward by deleting rows by hand.
- If `SUPABASE_SERVICE_ROLE_KEY` is missing, deletion returns 503 `deletion_unconfigured` and other authenticated routes return the same code. Sign-out still works. Put the key back. Do not point deletion at the anon key.
- After a job is `in_progress` or `blocked`, keep this backend. The previous backend will not finish the job. Retry with the same receipt.
- If blocker cleanup committed and `deleteUser` did not, the auth user and the Apple transaction id on `user_profiles` are still there. Retry with the same receipt. Do not delete `user_profiles` first.
- A `completed` job is terminal. Storage still `pending` belongs to the sweep.
- Receipt expiry only hides status. It does not move receipt ownership.

## Production schema

The migration was checked against a local replica of the audited blocker chain, not against the live database. Checkpoint 2 is the live read-only recheck. Stop if it disagrees with `lifestyle_scores` and `onboarding_questions` as the only NO ACTION children of `public.users`.

