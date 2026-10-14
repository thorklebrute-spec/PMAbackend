import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const container = 'pma-deletion-itest';
const image = 'postgres:16';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const migrationPath = path.join(root, 'sql', 'migration_account_deletion.sql');

const results = [];

function record(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
}

function run(command, args, input) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
    if (input !== undefined) child.stdin.end(input);
    else child.stdin.end();
  });
}

async function psql(sql, { expectError = false } = {}) {
  const result = await run('docker', [
    'exec', '-i', container,
    'psql', '-U', 'postgres', '-d', 'deletion_test',
    '-v', 'ON_ERROR_STOP=1', '-q', '-t', '-A',
  ], sql);
  if (expectError) {
    if (result.code === 0) throw new Error(`expected SQL error, got: ${result.stdout}`);
    return `${result.stderr}\n${result.stdout}`;
  }
  if (result.code !== 0) {
    throw new Error(result.stderr || result.stdout || `psql exited ${result.code}`);
  }
  return result.stdout.trim();
}

async function psqlJson(sql) {
  const text = await psql(sql);
  return JSON.parse(text);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function stopContainer() {
  await run('docker', ['rm', '-f', container]);
}

async function startDatabase() {
  await stopContainer();
  const started = await run('docker', [
    'run', '-d', '--name', container,
    '-e', 'POSTGRES_HOST_AUTH_METHOD=trust',
    '-e', 'POSTGRES_DB=deletion_test',
    '-p', '127.0.0.1:55432:5432',
    image,
  ]);
  if (started.code !== 0) throw new Error(started.stderr || 'docker run failed');
  for (let attempt = 1; attempt <= 30; attempt += 1) {
    const ready = await run('docker', ['exec', container, 'pg_isready', '-U', 'postgres', '-d', 'deletion_test']);
    if (ready.code === 0) return;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error('disposable Postgres did not become ready');
}

async function applyFixtureAndMigration() {
  await psql(`
    CREATE ROLE anon NOLOGIN;
    CREATE ROLE authenticated NOLOGIN;
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
    CREATE TABLE public.users (
      id uuid PRIMARY KEY,
      email text
    );
    CREATE TABLE public.lifestyle_scores (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL REFERENCES public.users(id)
    );
    CREATE TABLE public.onboarding_questions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL REFERENCES public.users(id)
    );
    CREATE TABLE public.user_profiles (
      id uuid PRIMARY KEY,
      apple_original_transaction_id text
    );
  `);
  const actions = await psql(`
    SELECT c.conrelid::regclass::text || ' ' || c.confdeltype::text
    FROM pg_constraint c
    WHERE c.contype = 'f'
      AND c.confrelid = 'public.users'::regclass
    ORDER BY 1;
  `);
  assert(actions.includes('lifestyle_scores a'), `expected NO ACTION on lifestyle_scores, got ${actions}`);
  assert(actions.includes('onboarding_questions a'), `expected NO ACTION on onboarding_questions, got ${actions}`);
  const migration = await readFile(migrationPath, 'utf8');
  await psql(migration);
}

async function testBlockerCleanup() {
  const userId = '11111111-1111-4111-8111-111111111111';
  await psql(`
    INSERT INTO public.users (id, email) VALUES ('${userId}', 'fixture@example.test');
    INSERT INTO public.lifestyle_scores (user_id) VALUES ('${userId}');
    INSERT INTO public.onboarding_questions (user_id) VALUES ('${userId}');
    INSERT INTO public.user_profiles (id, apple_original_transaction_id)
      VALUES ('${userId}', 'apple-original-fixture');
    SELECT public.delete_account_blockers('${userId}'::uuid);
  `);
  const counts = await psql(`
    SELECT
      (SELECT count(*) FROM public.users WHERE id = '${userId}') || ',' ||
      (SELECT count(*) FROM public.lifestyle_scores WHERE user_id = '${userId}') || ',' ||
      (SELECT count(*) FROM public.onboarding_questions WHERE user_id = '${userId}') || ',' ||
      (SELECT apple_original_transaction_id FROM public.user_profiles WHERE id = '${userId}');
  `);
  assert(counts === '0,0,0,apple-original-fixture', counts);
}

async function testRls() {
  const flags = await psql(`
    SELECT c.relrowsecurity::text || ',' || c.relforcerowsecurity::text
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'deletion_jobs';
  `);
  assert(flags.startsWith('true,'), flags);
  const anonSelect = await psql(`SET ROLE anon; SELECT count(*) FROM public.deletion_jobs;`, { expectError: true });
  assert(/permission denied/i.test(anonSelect), anonSelect);
  const anonExecute = await psql(`
    SET ROLE anon;
    SELECT public.claim_deletion_job(
      '22222222-2222-4222-8222-222222222222', 'hash', 'prefix', NULL, 300
    );
  `, { expectError: true });
  assert(/permission denied/i.test(anonExecute), anonExecute);
  const authenticatedExecute = await psql(`
    SET ROLE authenticated;
    SELECT public.delete_account_blockers('22222222-2222-4222-8222-222222222222');
  `, { expectError: true });
  assert(/permission denied/i.test(authenticatedExecute), authenticatedExecute);
  await psql(`
    SET ROLE service_role;
    SELECT public.claim_deletion_job(
      '33333333-3333-4333-8333-333333333333', 'service-role-hash', 'prefix', NULL, 300
    );
    RESET ROLE;
  `);
  const visible = await psql(`
    SET ROLE service_role;
    SELECT count(*) FROM public.deletion_jobs WHERE receipt_hash = 'service-role-hash';
  `);
  assert(visible === '1', visible);
}

async function claim(userId, hash) {
  return psqlJson(`
    SELECT public.claim_deletion_job('${userId}'::uuid, '${hash}', 'profile-pictures/${userId}', NULL, 300);
  `);
}

async function testClaimLifecycle() {
  const userId = '44444444-4444-4444-8444-444444444444';
  const created = await claim(userId, 'hash-owner');
  assert(created.reason === 'created' && created.claimed === true, JSON.stringify(created));
  const same = await claim(userId, 'hash-owner');
  assert(same.reason === 'in_progress' && same.claimed === false, JSON.stringify(same));
  const other = await claim(userId, 'hash-other');
  assert(other.reason === 'receipt_mismatch', JSON.stringify(other));
  const before = await psql(`
    SELECT receipt_hash || ',' || claim_token
    FROM public.deletion_jobs WHERE user_id = '${userId}';
  `);
  await psql(`
    UPDATE public.deletion_jobs
    SET claimed_at = now() - interval '10 minutes', state = 'in_progress'
    WHERE user_id = '${userId}';
  `);
  const reclaimed = await claim(userId, 'hash-owner');
  assert(reclaimed.reason === 'reclaimed' && reclaimed.claimed === true, JSON.stringify(reclaimed));
  const after = await psql(`
    SELECT receipt_hash || ',' || claim_token
    FROM public.deletion_jobs WHERE user_id = '${userId}';
  `);
  assert(after.startsWith('hash-owner,'), after);
  assert(after !== before, 'stale reclaim did not rotate the claim token');

  await psql(`
    UPDATE public.deletion_jobs
    SET state = 'completed', claim_token = '55555555-5555-4555-8555-555555555555'
    WHERE user_id = '${userId}';
  `);
  const done = await claim(userId, 'hash-owner');
  const wrong = await claim(userId, 'hash-finished-other');
  assert(done.reason === 'already_completed', JSON.stringify(done));
  assert(wrong.reason === 'receipt_mismatch', JSON.stringify(wrong));
  const terminal = await psql(`
    SELECT state || ',' || receipt_hash || ',' || claim_token
    FROM public.deletion_jobs WHERE user_id = '${userId}';
  `);
  assert(
    terminal === 'completed,hash-owner,55555555-5555-4555-8555-555555555555',
    terminal,
  );

  const stranger = '66666666-6666-4666-8666-666666666666';
  const occupied = await claim(stranger, 'hash-owner');
  assert(occupied.reason === 'receipt_in_use' && occupied.claimed === false, JSON.stringify(occupied));
  assert(!JSON.stringify(occupied).includes(userId), JSON.stringify(occupied));
  const strangerRows = await psql(`SELECT count(*) FROM public.deletion_jobs WHERE user_id = '${stranger}';`);
  assert(strangerRows === '0', strangerRows);

  const invalid = await psql(`
    SELECT public.claim_deletion_job(
      '77777777-7777-4777-8777-777777777777', 'unused-hash', 'prefix', NULL, 0
    );
  `, { expectError: true });
  assert(/invalid stale lease duration/i.test(invalid), invalid);
  const invalidRows = await psql(`
    SELECT count(*) FROM public.deletion_jobs
    WHERE user_id = '77777777-7777-4777-8777-777777777777';
  `);
  assert(invalidRows === '0', invalidRows);
}

async function testConcurrentClaims() {
  const userId = '88888888-8888-4888-8888-888888888888';
  const [first, second] = await Promise.all([
    claim(userId, 'concurrent-a'),
    claim(userId, 'concurrent-b'),
  ]);
  const reasons = [first.reason, second.reason].sort();
  assert(reasons.join(',') === 'created,receipt_mismatch', JSON.stringify([first, second]));
  const rows = await psql(`SELECT count(*) FROM public.deletion_jobs WHERE user_id = '${userId}';`);
  assert(rows === '1', rows);

  const left = '99999999-9999-4999-8999-999999999999';
  const right = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const [owned, rejected] = await Promise.all([
    claim(left, 'shared-receipt'),
    claim(right, 'shared-receipt'),
  ]);
  const sharedReasons = [owned.reason, rejected.reason].sort();
  assert(sharedReasons.join(',') === 'created,receipt_in_use', JSON.stringify([owned, rejected]));
  const owners = await psql(`SELECT count(*) FROM public.deletion_jobs WHERE receipt_hash = 'shared-receipt';`);
  assert(owners === '1', owners);
}

async function main() {
  try {
    await startDatabase();
    await applyFixtureAndMigration();
    record('fixture matches audited NO ACTION blocker chain and migration applies', true);
  } catch (error) {
    record('fixture matches audited NO ACTION blocker chain and migration applies', false, error.message);
    return;
  }

  const steps = [
    ['blocker cleanup removes the NO ACTION chain and keeps the Apple profile', testBlockerCleanup],
    ['RLS denies anon and authenticated while service_role can claim', testRls],
    ['claim lifecycle is terminal, receipt-stable, and does not leak the other account', testClaimLifecycle],
    ['concurrent claims serialize to one row', testConcurrentClaims],
  ];
  for (const [name, step] of steps) {
    try {
      await step();
      record(name, true);
    } catch (error) {
      record(name, false, error.message);
    }
  }
}

try {
  await main();
} finally {
  await stopContainer();
}

const failed = results.filter((item) => !item.ok);
console.log(`integration ${results.length - failed.length} passed, ${failed.length} failed`);
if (failed.length > 0 || results.length === 0) process.exit(1);
