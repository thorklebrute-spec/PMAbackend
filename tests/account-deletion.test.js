import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { createAccountDeletionService } from '../src/services/accountDeletionService.js';
import {
  applyClaim,
  canRemoveDeletionJob,
  hashReceipt,
  isMissingDeletionStore,
  otherUserOwnsReceipt,
  shouldBlockAuthenticatedRoute,
  STALE_CLAIM_MS,
} from '../src/services/deletionRules.js';

const RECEIPT = 'a'.repeat(43);
const OTHER_RECEIPT = 'b'.repeat(43);

function createHarness(options = {}) {
  const jobs = new Map();
  const profiles = new Map();
  const authUsers = new Set(options.authUsers || []);
  const storage = new Map();
  const calls = {
    stripeList: 0,
    stripeCancel: [],
    idempotencyKeys: [],
    deleteUser: [],
    getUser: [],
    blockers: [],
    profileSelects: [],
    profileDeletes: [],
    appleProfileAtDelete: [],
  };
  let blockersFail = options.blockersFail || false;
  let storageFail = options.storageFail || false;
  let deleteUserError = options.deleteUserError || null;
  let forceAuthUserPresent = options.forceAuthUserPresent || false;
  let stealClaimOnStripe = options.stealClaimOnStripe || false;
  const stripePages = options.stripePages || [];
  const now = options.now || (() => Date.now());

  function matchJob(filters) {
    const userId = filters.find(([column]) => column === 'user_id')?.[1];
    const token = filters.find(([column]) => column === 'claim_token')?.[1];
    const hash = filters.find(([column]) => column === 'receipt_hash')?.[1];
    const state = filters.find(([column]) => column === 'state')?.[1];
    const storageStatus = filters.find(([column]) => column === 'storage_status')?.[1];
    let job = null;
    if (userId) job = jobs.get(userId) || null;
    else if (hash) job = [...jobs.values()].find((row) => row.receipt_hash === hash) || null;
    if (!job) return null;
    if (token && job.claim_token !== token) return null;
    if (state && job.state !== state) return null;
    if (storageStatus && job.storage_status !== storageStatus) return null;
    return job;
  }

  const supabaseAdmin = {
    async rpc(name, args) {
      if (name === 'claim_deletion_job') {
        const existing = jobs.get(args.p_user_id) || null;
        if (otherUserOwnsReceipt([...jobs.values()], args.p_user_id, args.p_receipt_hash)) {
          return {
            data: {
              claimed: false,
              reason: 'receipt_in_use',
              claim_token: null,
              state: null,
            },
            error: null,
          };
        }
        try {
          const outcome = applyClaim(existing, {
            userId: args.p_user_id,
            receiptHash: args.p_receipt_hash,
            claimToken: randomUUID(),
            storagePrefix: args.p_storage_prefix,
            stripeCustomerId: args.p_stripe_customer_id,
            staleSeconds: args.p_stale_seconds,
          }, now());
          if (outcome.claimed) jobs.set(args.p_user_id, outcome.job);
          return {
            data: {
              claimed: outcome.claimed,
              reason: outcome.reason,
              claim_token: outcome.claim_token,
              state: outcome.state,
            },
            error: null,
          };
        } catch (error) {
          return { data: null, error };
        }
      }
      if (name === 'delete_account_blockers') {
        calls.blockers.push(args.p_user_id);
        if (blockersFail) return { data: null, error: new Error('blocker failed') };
        return { data: null, error: null };
      }
      return { data: null, error: new Error(`unknown rpc ${name}`) };
    },
    from(table) {
      const filters = [];
      let patch = null;
      let operation = 'select';
      const builder = {
        select(columns) {
          if (table === 'user_profiles') {
            calls.profileSelects.push(String(columns));
            if (String(columns).includes('subscription_id')) {
              throw new Error('subscription_id must not be read during deletion');
            }
          }
          return builder;
        },
        update(value) {
          operation = 'update';
          patch = value;
          return builder;
        },
        delete() {
          operation = 'delete';
          if (table === 'user_profiles') calls.profileDeletes.push(true);
          return builder;
        },
        eq(column, value) {
          filters.push([column, value]);
          return builder;
        },
        maybeSingle() {
          if (table === 'user_profiles') {
            const id = filters.find(([column]) => column === 'id')?.[1];
            return Promise.resolve({ data: profiles.get(id) || null, error: null });
          }
          return Promise.resolve({ data: matchJob(filters), error: null });
        },
        then(resolve, reject) {
          return Promise.resolve().then(() => {
            if (table === 'user_profiles' && operation === 'delete') {
              throw new Error('user_profiles must not be deleted directly');
            }
            if (operation === 'update' && table === 'deletion_jobs') {
              const job = matchJob(filters);
              if (!job) return { data: [], error: null };
              Object.assign(job, patch);
              return { data: [{ user_id: job.user_id }], error: null };
            }
            if (operation === 'delete' && table === 'deletion_jobs') {
              const job = matchJob(filters);
              if (!job) return { data: [], error: null };
              jobs.delete(job.user_id);
              return { data: [{ user_id: job.user_id }], error: null };
            }
            if (operation === 'select' && table === 'deletion_jobs') {
              return { data: [...jobs.values()], error: null };
            }
            return { data: [], error: null };
          }).then(resolve, reject);
        },
      };
      return builder;
    },
    storage: {
      from() {
        return {
          async list(folder, { limit, offset }) {
            if (storageFail) return { data: null, error: new Error('list failed') };
            const userId = folder.split('/')[1];
            const files = storage.get(userId) || [];
            return { data: files.slice(offset, offset + limit), error: null };
          },
          async remove(paths) {
            if (storageFail) return { error: new Error('remove failed') };
            for (const filePath of paths) {
              const [, userId, name] = filePath.split('/');
              storage.set(userId, (storage.get(userId) || []).filter((file) => file.name !== name));
            }
            return { error: null };
          },
        };
      },
    },
    auth: {
      admin: {
        async deleteUser(userId) {
          calls.deleteUser.push(userId);
          calls.appleProfileAtDelete.push(profiles.has(userId));
          if (deleteUserError) return { data: null, error: deleteUserError };
          authUsers.delete(userId);
          return { data: {}, error: null };
        },
        async getUserById(userId) {
          calls.getUser.push(userId);
          if (forceAuthUserPresent || authUsers.has(userId)) {
            return { data: { user: { id: userId } }, error: null };
          }
          return { data: { user: null }, error: { status: 404, message: 'User not found' } };
        },
      },
    },
  };

  const stripe = {
    subscriptions: {
      async list(params) {
        calls.stripeList += 1;
        if (stealClaimOnStripe) {
          const job = [...jobs.values()][0];
          if (job) job.claim_token = randomUUID();
        }
        if (typeof options.listImpl === 'function') return options.listImpl(params, calls);
        const page = stripePages[calls.stripeList - 1] || { data: [], has_more: false };
        return page;
      },
      async cancel(id, _params, requestOptions) {
        calls.stripeCancel.push(id);
        calls.idempotencyKeys.push(requestOptions?.idempotencyKey);
        if (options.cancelError?.code === 'resource_missing') {
          throw options.cancelError;
        }
        if (options.failFirstCancel && calls.stripeCancel.length === 1) {
          throw options.cancelError || new Error('stripe down');
        }
        return { id, status: 'canceled' };
      },
    },
  };

  const service = createAccountDeletionService({
    supabaseAdmin,
    stripe,
    now,
    sweepToken: () => options.sweepToken ?? 'sweep-token',
    stripePageSize: options.stripePageSize || 100,
    storagePageSize: options.storagePageSize || 100,
    rateLimit: options.rateLimit ?? 30,
    rateWindowMs: options.rateWindowMs ?? 60_000,
    serviceRoleConfigured: options.serviceRoleConfigured,
  });

  return {
    service,
    jobs,
    profiles,
    storage,
    calls,
    supabaseAdmin,
    setBlockersFail(value) { blockersFail = value; },
    setStorageFail(value) { storageFail = value; },
  };
}

function appleProfile(userId) {
  return {
    id: userId,
    billing_provider: 'apple',
    stripe_customer_id: null,
    apple_original_transaction_id: 'apple-original-1',
  };
}

test('Apple deletion never calls Stripe and keeps the profile until auth deletion', async () => {
  const userId = randomUUID();
  const harness = createHarness({ authUsers: [userId] });
  harness.profiles.set(userId, appleProfile(userId));
  const outcome = await harness.service.deleteAccount({ userId, receipt: RECEIPT });
  assert.equal(outcome.httpStatus, 200);
  assert.equal(outcome.body.success, true);
  assert.equal(harness.calls.stripeList, 0);
  assert.deepEqual(harness.calls.profileDeletes, []);
  assert.equal(harness.calls.appleProfileAtDelete[0], true);
  assert.equal(harness.profiles.get(userId).apple_original_transaction_id, 'apple-original-1');
  assert.equal(harness.jobs.get(userId).state, 'completed');
  assert.equal(harness.jobs.get(userId).stripe_status, 'not_required');
  assert.ok(!harness.calls.profileSelects.some((columns) => columns.includes('subscription_id')));
});

test('Stripe pagination follows has_more and cancel is idempotent', async () => {
  const userId = randomUUID();
  const harness = createHarness({
    authUsers: [userId],
    stripePageSize: 1,
    stripePages: [
      { data: [{ id: 'sub_1', status: 'active' }, { id: 'sub_old', status: 'canceled' }], has_more: true },
      { data: [{ id: 'sub_2', status: 'active' }], has_more: false },
    ],
  });
  harness.profiles.set(userId, { billing_provider: 'stripe', stripe_customer_id: 'cus_1' });
  const outcome = await harness.service.deleteAccount({ userId, receipt: RECEIPT });
  assert.equal(outcome.httpStatus, 200);
  assert.equal(harness.calls.stripeList, 2);
  assert.deepEqual(harness.calls.stripeCancel, ['sub_1', 'sub_2']);
  assert.deepEqual(harness.calls.idempotencyKeys, [
    `account-deletion-${userId}-sub_1`,
    `account-deletion-${userId}-sub_2`,
  ]);

  harness.calls.stripeCancel = [];
  harness.setBlockersFail(false);
  const retry = await harness.service.deleteAccount({ userId, receipt: RECEIPT });
  assert.equal(retry.httpStatus, 200);
  assert.ok(harness.calls.idempotencyKeys.includes(`account-deletion-${userId}-sub_1`));
});

test('a Stripe cancellation failure blocks auth deletion', async () => {
  const userId = randomUUID();
  const harness = createHarness({
    authUsers: [userId],
    failFirstCancel: true,
    cancelError: new Error('stripe down'),
    stripePages: [{ data: [{ id: 'sub_1', status: 'active' }], has_more: false }],
  });
  harness.profiles.set(userId, { billing_provider: 'stripe', stripe_customer_id: 'cus_1' });
  const outcome = await harness.service.deleteAccount({ userId, receipt: RECEIPT });
  assert.equal(outcome.httpStatus, 503);
  assert.equal(outcome.body.code, 'stripe_cancellation_failed');
  assert.equal(harness.calls.deleteUser.length, 0);
  assert.equal(harness.jobs.get(userId).state, 'blocked');
  assert.equal(harness.jobs.get(userId).last_error, 'stripe_cancellation_failed');
  assert.equal(String(harness.jobs.get(userId).last_error).includes('stripe down'), false);
  assert.match(outcome.body.error, /contact support/);
});

test('a free account skips Stripe', async () => {
  const userId = randomUUID();
  const harness = createHarness({ authUsers: [userId] });
  harness.profiles.set(userId, { billing_provider: null, stripe_customer_id: null });
  const outcome = await harness.service.deleteAccount({ userId, receipt: RECEIPT });
  assert.equal(outcome.httpStatus, 200);
  assert.equal(harness.calls.stripeList, 0);
  assert.equal(harness.jobs.get(userId).stripe_status, 'not_required');
});

test('blocker cleanup failure can be retried without deleting the auth user early', async () => {
  const userId = randomUUID();
  const harness = createHarness({ authUsers: [userId], blockersFail: true });
  harness.profiles.set(userId, appleProfile(userId));
  const failed = await harness.service.deleteAccount({ userId, receipt: RECEIPT });
  assert.equal(failed.httpStatus, 503);
  assert.equal(failed.body.code, 'deletion_cleanup_failed');
  assert.equal(harness.calls.deleteUser.length, 0);
  assert.equal(harness.jobs.get(userId).state, 'blocked');

  harness.setBlockersFail(false);
  const retried = await harness.service.deleteAccount({ userId, receipt: RECEIPT });
  assert.equal(retried.httpStatus, 200);
  assert.equal(harness.calls.deleteUser.length, 1);
  assert.equal(harness.calls.appleProfileAtDelete[0], true);
});

test('overlapping claims do not run two deletion workflows', async () => {
  const userId = randomUUID();
  const harness = createHarness({ authUsers: [userId] });
  harness.profiles.set(userId, appleProfile(userId));
  const [first, second] = await Promise.all([
    harness.service.deleteAccount({ userId, receipt: RECEIPT }),
    harness.service.deleteAccount({ userId, receipt: RECEIPT }),
  ]);
  const statuses = [first.httpStatus, second.httpStatus].sort();
  assert.deepEqual(statuses, [200, 409]);
  assert.equal(harness.calls.deleteUser.length, 1);
  assert.equal(second.body.code || first.body.code, 'deletion_in_progress');
});

test('a stale claim can be recovered by the same receipt', async () => {
  const userId = randomUUID();
  let clock = Date.now();
  const harness = createHarness({ authUsers: [userId], now: () => clock });
  harness.profiles.set(userId, appleProfile(userId));
  harness.jobs.set(userId, {
    user_id: userId,
    receipt_hash: applyClaim(null, {
      userId,
      receiptHash: 'hash-placeholder',
      claimToken: randomUUID(),
      storagePrefix: 'x',
    }, clock).job.receipt_hash,
    claim_token: randomUUID(),
    claimed_at: new Date(clock - STALE_CLAIM_MS - 1000).toISOString(),
    state: 'in_progress',
    stripe_status: 'unknown',
    storage_status: 'not_required',
    storage_prefix: `profile-pictures/${userId}`,
    expires_at: new Date(clock + 60_000).toISOString(),
  });
  const { hashReceipt } = await import('../src/services/deletionRules.js');
  harness.jobs.get(userId).receipt_hash = hashReceipt(RECEIPT);
  const outcome = await harness.service.deleteAccount({ userId, receipt: RECEIPT });
  assert.equal(outcome.httpStatus, 200);
  assert.equal(harness.calls.deleteUser.length, 1);
});

test('a missing public.users row is not proof the auth user is gone', async () => {
  const userId = randomUUID();
  const harness = createHarness({ authUsers: [userId], forceAuthUserPresent: true });
  harness.profiles.set(userId, appleProfile(userId));
  const outcome = await harness.service.deleteAccount({ userId, receipt: RECEIPT });
  assert.equal(outcome.httpStatus, 503);
  assert.equal(outcome.body.code, 'deletion_incomplete');
  assert.equal(harness.calls.getUser.length, 1);
  assert.notEqual(harness.jobs.get(userId).state, 'completed');
  assert.equal(harness.profiles.has(userId), true);
});

test('deleteUser not-found while the auth user still exists stays incomplete', async () => {
  const userId = randomUUID();
  const harness = createHarness({
    authUsers: [userId],
    deleteUserError: { status: 404, message: 'User not found' },
    forceAuthUserPresent: true,
  });
  harness.profiles.set(userId, appleProfile(userId));
  const outcome = await harness.service.deleteAccount({ userId, receipt: RECEIPT });
  assert.equal(outcome.httpStatus, 503);
  assert.equal(outcome.body.code, 'deletion_incomplete');
  assert.notEqual(harness.jobs.get(userId).state, 'completed');
});

test('storage failure still deletes the auth user and the sweep retries it', async () => {
  const userId = randomUUID();
  const harness = createHarness({ authUsers: [userId], storageFail: true, storagePageSize: 1 });
  harness.profiles.set(userId, appleProfile(userId));
  harness.storage.set(userId, [
    { id: '1', name: 'a.png' },
    { id: '2', name: 'b.png' },
  ]);
  const outcome = await harness.service.deleteAccount({ userId, receipt: RECEIPT });
  assert.equal(outcome.httpStatus, 200);
  assert.equal(harness.calls.deleteUser.length, 1);
  assert.equal(harness.jobs.get(userId).storage_status, 'pending');
  assert.equal(harness.jobs.get(userId).last_error, 'storage_cleanup_pending');
  assert.equal(harness.storage.get(userId).length, 2);

  const wrongToken = await harness.service.sweepStorage('not-the-token');
  assert.equal(wrongToken.httpStatus, 401);
  const unconfigured = createHarness({ sweepToken: '' });
  assert.equal((await unconfigured.service.sweepStorage('anything')).httpStatus, 503);
  assert.equal((await unconfigured.service.sweepStorage('anything')).body.code, 'sweep_not_configured');

  harness.setStorageFail(false);
  const swept = await harness.service.sweepStorage('sweep-token');
  assert.equal(swept.httpStatus, 200);
  assert.equal(swept.body.pending, 0);
  assert.equal(swept.body.swept, 1);
  assert.equal(harness.storage.get(userId).length, 0);
  assert.equal(Object.hasOwn(swept.body, 'user_id'), false);
});

test('lost response status returns completed without account data', async () => {
  const userId = randomUUID();
  const harness = createHarness({ authUsers: [userId] });
  harness.profiles.set(userId, appleProfile(userId));
  await harness.service.deleteAccount({ userId, receipt: RECEIPT });
  const status = await harness.service.getStatus(RECEIPT, '203.0.113.5');
  assert.deepEqual(status, { httpStatus: 200, body: { state: 'completed' } });
  assert.equal(JSON.stringify(status.body).includes(userId), false);
  const repeat = await harness.service.getStatus(RECEIPT, '203.0.113.5');
  assert.deepEqual(repeat.body, { state: 'completed' });
});

test('expired, unknown, and rate-limited status checks do not reveal accounts', async () => {
  const userId = randomUUID();
  let clock = Date.now();
  const harness = createHarness({
    authUsers: [userId],
    now: () => clock,
    rateLimit: 2,
    rateWindowMs: 60_000,
  });
  harness.profiles.set(userId, appleProfile(userId));
  await harness.service.deleteAccount({ userId, receipt: RECEIPT });
  const owned = {
    user_id: harness.jobs.get(userId).user_id,
    receipt_hash: harness.jobs.get(userId).receipt_hash,
    claim_token: harness.jobs.get(userId).claim_token,
    state: harness.jobs.get(userId).state,
  };
  clock += 25 * 60 * 60 * 1000;
  assert.deepEqual((await harness.service.getStatus(RECEIPT, '203.0.113.8')).body, { state: 'unknown' });
  assert.equal(harness.jobs.get(userId).user_id, owned.user_id);
  assert.equal(harness.jobs.get(userId).receipt_hash, owned.receipt_hash);
  assert.equal(harness.jobs.get(userId).claim_token, owned.claim_token);
  assert.equal(harness.jobs.get(userId).state, owned.state);
  assert.deepEqual((await harness.service.getStatus('c'.repeat(43), '203.0.113.9')).body, { state: 'unknown' });
  assert.deepEqual((await harness.service.getStatus('nope', '203.0.113.10')).body, { state: 'unknown' });
  const limitedHarness = createHarness({ rateLimit: 1, rateWindowMs: 60_000 });
  assert.equal((await limitedHarness.service.getStatus(RECEIPT, '203.0.113.11')).httpStatus, 200);
  const limited = await limitedHarness.service.getStatus(OTHER_RECEIPT, '203.0.113.11');
  assert.equal(limited.httpStatus, 429);
  assert.equal(limited.body.code, 'rate_limited');
  assert.equal(Object.hasOwn(limited.body, 'user_id'), false);
});

test('a different receipt is rejected while a claim is fresh', async () => {
  const userId = randomUUID();
  const harness = createHarness({ authUsers: [userId] });
  harness.profiles.set(userId, appleProfile(userId));
  harness.jobs.set(userId, {
    user_id: userId,
    receipt_hash: (await import('../src/services/deletionRules.js')).hashReceipt(RECEIPT),
    claim_token: randomUUID(),
    claimed_at: new Date().toISOString(),
    state: 'in_progress',
    stripe_status: 'unknown',
    storage_status: 'not_required',
    storage_prefix: `profile-pictures/${userId}`,
    expires_at: new Date(Date.now() + 60_000).toISOString(),
  });
  const outcome = await harness.service.deleteAccount({ userId, receipt: OTHER_RECEIPT });
  assert.equal(outcome.httpStatus, 409);
  assert.equal(outcome.body.code, 'deletion_receipt_mismatch');
  assert.equal(harness.calls.deleteUser.length, 0);
  assert.equal(harness.jobs.get(userId).receipt_hash, (await import('../src/services/deletionRules.js')).hashReceipt(RECEIPT));
});

test('authenticated routes other than delete and sign-out stay blocked', () => {
  const job = { state: 'blocked' };
  assert.equal(shouldBlockAuthenticatedRoute('/rank', job), true);
  assert.equal(shouldBlockAuthenticatedRoute('/auth/user', job), true);
  assert.equal(shouldBlockAuthenticatedRoute('/auth/delete-account', job), false);
  assert.equal(shouldBlockAuthenticatedRoute('/auth/signout', job), false);
  assert.equal(shouldBlockAuthenticatedRoute('/rank', null), false);
  assert.equal(shouldBlockAuthenticatedRoute('/rank', { state: 'completed' }), false);
});

test('a lost claim during Stripe does not delete the auth user or the Apple profile', async () => {
  const userId = randomUUID();
  const harness = createHarness({
    authUsers: [userId],
    stealClaimOnStripe: true,
    stripePages: [{ data: [{ id: 'sub_1', status: 'active' }], has_more: false }],
  });
  harness.profiles.set(userId, {
    billing_provider: 'apple',
    stripe_customer_id: 'cus_left_over',
    apple_original_transaction_id: 'apple-original-1',
  });
  const outcome = await harness.service.deleteAccount({ userId, receipt: RECEIPT });
  assert.equal(outcome.httpStatus, 409);
  assert.equal(outcome.body.code, 'deletion_claim_lost');
  assert.equal(harness.calls.deleteUser.length, 0);
  assert.equal(harness.calls.blockers.length, 0);
  assert.equal(harness.profiles.get(userId).apple_original_transaction_id, 'apple-original-1');
});

test('receipt cleanup cannot remove unfinished deletion jobs', async () => {
  const userId = randomUUID();
  let clock = Date.now();
  const harness = createHarness({ now: () => clock, sweepToken: 'sweep-token' });
  const expired = new Date(clock - 1000).toISOString();
  harness.jobs.set('in-progress', {
    user_id: 'in-progress',
    state: 'in_progress',
    storage_status: 'settled',
    expires_at: expired,
    claim_token: randomUUID(),
  });
  harness.jobs.set('blocked', {
    user_id: 'blocked',
    state: 'blocked',
    storage_status: 'not_required',
    expires_at: expired,
    claim_token: randomUUID(),
  });
  harness.jobs.set('storage-pending', {
    user_id: 'storage-pending',
    state: 'completed',
    storage_status: 'pending',
    storage_prefix: 'profile-pictures/storage-pending',
    expires_at: expired,
    claim_token: randomUUID(),
  });
  harness.jobs.set('finished', {
    user_id: 'finished',
    state: 'completed',
    storage_status: 'settled',
    expires_at: expired,
    claim_token: randomUUID(),
  });
  harness.storage.set('storage-pending', [{ id: '1', name: 'pic.png' }]);
  const outcome = await harness.service.sweepStorage('sweep-token');
  assert.equal(outcome.httpStatus, 200);
  assert.equal(harness.jobs.has('in-progress'), true);
  assert.equal(harness.jobs.has('blocked'), true);
  assert.equal(harness.jobs.has('finished'), false);
  assert.equal(harness.jobs.get('storage-pending').storage_status, 'settled');
  assert.equal(outcome.body.removedReceipts, 1);
  assert.equal(canRemoveDeletionJob(harness.jobs.get('in-progress'), clock), false);
  assert.equal(canRemoveDeletionJob({
    state: 'completed',
    storage_status: 'pending',
    expires_at: expired,
  }, clock), false);
});

test('resource_missing from Stripe still allows deletion', async () => {
  const userId = randomUUID();
  const harness = createHarness({
    authUsers: [userId],
    cancelError: { code: 'resource_missing' },
    stripePages: [{ data: [{ id: 'sub_1', status: 'active' }], has_more: false }],
  });
  harness.profiles.set(userId, { billing_provider: 'stripe', stripe_customer_id: 'cus_1' });
  const outcome = await harness.service.deleteAccount({ userId, receipt: RECEIPT });
  assert.equal(outcome.httpStatus, 200);
  assert.equal(harness.calls.deleteUser.length, 1);
});

test('storage sweep failure leaves the job pending', async () => {
  const userId = randomUUID();
  const harness = createHarness({ storageFail: true, sweepToken: 'sweep-token' });
  harness.jobs.set(userId, {
    user_id: userId,
    state: 'completed',
    storage_status: 'pending',
    storage_prefix: `profile-pictures/${userId}`,
    expires_at: new Date(Date.now() + 60_000).toISOString(),
    claim_token: randomUUID(),
  });
  harness.storage.set(userId, [{ id: '1', name: 'pic.png' }]);
  const outcome = await harness.service.sweepStorage('sweep-token');
  assert.equal(outcome.httpStatus, 200);
  assert.equal(outcome.body.pending, 1);
  assert.equal(outcome.body.swept, 0);
  assert.equal(harness.jobs.get(userId).storage_status, 'pending');
  assert.equal(harness.jobs.get(userId).last_error, 'storage_cleanup_failed');
  assert.equal(String(harness.jobs.get(userId).last_error).includes('list failed'), false);
});

function unfinishedJob(userId, overrides = {}) {
  return {
    user_id: userId,
    receipt_hash: hashReceipt(RECEIPT),
    claim_token: randomUUID(),
    claimed_at: new Date().toISOString(),
    state: 'in_progress',
    stripe_status: 'pending',
    storage_status: 'pending',
    storage_prefix: `profile-pictures/${userId}`,
    last_error: 'storage_cleanup_failed',
    expires_at: new Date(Date.now() + 60_000).toISOString(),
    ...overrides,
  };
}

test('repeated claims on a completed job stay terminal for the original receipt', async () => {
  const userId = randomUUID();
  const harness = createHarness({ authUsers: [userId] });
  const originalToken = randomUUID();
  const receiptHash = hashReceipt(RECEIPT);
  harness.profiles.set(userId, appleProfile(userId));
  harness.jobs.set(userId, unfinishedJob(userId, {
    claim_token: originalToken,
    receipt_hash: receiptHash,
    state: 'completed',
    stripe_status: 'not_required',
    storage_status: 'settled',
    last_error: null,
  }));
  const first = await harness.service.deleteAccount({ userId, receipt: RECEIPT });
  const second = await harness.service.deleteAccount({ userId, receipt: RECEIPT });
  assert.equal(first.httpStatus, 200);
  assert.equal(first.body.code, 'already_completed');
  assert.equal(second.httpStatus, 200);
  assert.equal(second.body.code, 'already_completed');
  assert.equal(harness.calls.deleteUser.length, 0);
  assert.equal(harness.jobs.get(userId).state, 'completed');
  assert.equal(harness.jobs.get(userId).receipt_hash, receiptHash);
  assert.equal(harness.jobs.get(userId).claim_token, originalToken);
});

test('a different receipt cannot reopen a completed job', async () => {
  const userId = randomUUID();
  const harness = createHarness({ authUsers: [userId] });
  const originalToken = randomUUID();
  const receiptHash = hashReceipt(RECEIPT);
  harness.profiles.set(userId, appleProfile(userId));
  harness.jobs.set(userId, unfinishedJob(userId, {
    claim_token: originalToken,
    receipt_hash: receiptHash,
    state: 'completed',
  }));
  const outcome = await harness.service.deleteAccount({ userId, receipt: OTHER_RECEIPT });
  assert.equal(outcome.httpStatus, 409);
  assert.equal(outcome.body.code, 'deletion_receipt_mismatch');
  assert.equal(harness.calls.deleteUser.length, 0);
  assert.equal(harness.jobs.get(userId).state, 'completed');
  assert.equal(harness.jobs.get(userId).receipt_hash, receiptHash);
  assert.equal(harness.jobs.get(userId).claim_token, originalToken);
  assert.equal(JSON.stringify(outcome.body).includes(userId), false);
});

test('the original receipt reclaims a stale job without changing ownership', async () => {
  const now = Date.now();
  const existing = unfinishedJob('user-1', {
    claim_token: 'original-token',
    claimed_at: new Date(now - STALE_CLAIM_MS - 1000).toISOString(),
  });
  const outcome = applyClaim(existing, {
    userId: 'user-1',
    receiptHash: hashReceipt(RECEIPT),
    claimToken: 'next-token',
    storagePrefix: 'profile-pictures/user-1',
    staleSeconds: 300,
  }, now);
  assert.equal(outcome.claimed, true);
  assert.equal(outcome.reason, 'reclaimed');
  assert.equal(outcome.job.receipt_hash, existing.receipt_hash);
  assert.equal(outcome.job.claim_token, 'next-token');
  assert.equal(outcome.job.stripe_status, 'pending');
  assert.equal(outcome.job.storage_status, 'pending');
  assert.equal(outcome.job.last_error, null);
  assert.equal(existing.claim_token, 'original-token');
});

test('the original receipt reclaims a blocked job immediately', async () => {
  const userId = randomUUID();
  const harness = createHarness({ authUsers: [userId] });
  const receiptHash = hashReceipt(RECEIPT);
  const originalToken = randomUUID();
  harness.profiles.set(userId, appleProfile(userId));
  harness.jobs.set(userId, unfinishedJob(userId, {
    claim_token: originalToken,
    receipt_hash: receiptHash,
    state: 'blocked',
    claimed_at: new Date().toISOString(),
  }));
  const outcome = await harness.service.deleteAccount({ userId, receipt: RECEIPT });
  assert.equal(outcome.httpStatus, 200);
  assert.equal(harness.calls.deleteUser.length, 1);
  assert.equal(harness.jobs.get(userId).receipt_hash, receiptHash);
  assert.notEqual(harness.jobs.get(userId).claim_token, originalToken);
});

test('a different receipt cannot take fresh or stale in-progress and blocked jobs', async () => {
  for (const state of ['in_progress', 'blocked']) {
    for (const stale of [false, true]) {
      const userId = randomUUID();
      const harness = createHarness({ authUsers: [userId] });
      const receiptHash = hashReceipt(RECEIPT);
      const originalToken = randomUUID();
      harness.profiles.set(userId, appleProfile(userId));
      harness.jobs.set(userId, unfinishedJob(userId, {
        claim_token: originalToken,
        receipt_hash: receiptHash,
        state,
        claimed_at: new Date(Date.now() - (stale ? STALE_CLAIM_MS + 1000 : 0)).toISOString(),
      }));
      const outcome = await harness.service.deleteAccount({ userId, receipt: OTHER_RECEIPT });
      assert.equal(outcome.httpStatus, 409);
      assert.equal(outcome.body.code, 'deletion_receipt_mismatch');
      assert.equal(harness.calls.deleteUser.length, 0);
      assert.equal(harness.jobs.get(userId).state, state);
      assert.equal(harness.jobs.get(userId).receipt_hash, receiptHash);
      assert.equal(harness.jobs.get(userId).claim_token, originalToken);
    }
  }
});

test('an expired unfinished job stays recoverable only by its original receipt', async () => {
  const userId = randomUUID();
  let clock = Date.now();
  const harness = createHarness({ authUsers: [userId], now: () => clock });
  const receiptHash = hashReceipt(RECEIPT);
  const originalToken = randomUUID();
  harness.profiles.set(userId, appleProfile(userId));
  harness.jobs.set(userId, unfinishedJob(userId, {
    claim_token: originalToken,
    receipt_hash: receiptHash,
    claimed_at: new Date(clock - STALE_CLAIM_MS - 1000).toISOString(),
    expires_at: new Date(clock - 1000).toISOString(),
  }));
  const mismatch = await harness.service.deleteAccount({ userId, receipt: OTHER_RECEIPT });
  assert.equal(mismatch.httpStatus, 409);
  assert.equal(mismatch.body.code, 'deletion_receipt_mismatch');
  assert.equal(harness.jobs.get(userId).state, 'in_progress');
  assert.equal(harness.jobs.get(userId).receipt_hash, receiptHash);
  assert.equal(harness.jobs.get(userId).claim_token, originalToken);
  assert.equal(harness.calls.deleteUser.length, 0);

  const recovered = await harness.service.deleteAccount({ userId, receipt: RECEIPT });
  assert.equal(recovered.httpStatus, 200);
  assert.equal(harness.calls.deleteUser.length, 1);
  assert.equal(harness.jobs.get(userId).receipt_hash, receiptHash);
  assert.notEqual(harness.jobs.get(userId).claim_token, originalToken);
});

test('a fresh lease is not replaced because the status receipt expired', () => {
  const now = Date.now();
  const existing = unfinishedJob('user-1', {
    claim_token: 'original-token',
    claimed_at: new Date(now).toISOString(),
    expires_at: new Date(now - 1000).toISOString(),
  });
  const outcome = applyClaim(existing, {
    userId: 'user-1',
    receiptHash: hashReceipt(RECEIPT),
    claimToken: 'next-token',
    storagePrefix: 'profile-pictures/user-1',
    staleSeconds: 300,
  }, now);
  assert.equal(outcome.claimed, false);
  assert.equal(outcome.reason, 'in_progress');
  assert.equal(existing.claim_token, 'original-token');
  assert.equal(existing.receipt_hash, hashReceipt(RECEIPT));
});

test('invalid lease durations fail before any job write', async () => {
  const userId = randomUUID();
  const harness = createHarness();
  const original = unfinishedJob(userId, { claim_token: 'original-token' });
  harness.jobs.set(userId, original);
  for (const staleSeconds of [null, 0, -1, 601]) {
    const response = await harness.supabaseAdmin.rpc('claim_deletion_job', {
      p_user_id: userId,
      p_receipt_hash: hashReceipt(OTHER_RECEIPT),
      p_storage_prefix: `profile-pictures/${userId}`,
      p_stripe_customer_id: null,
      p_stale_seconds: staleSeconds,
    });
    assert.equal(response.error.code, '22023');
    assert.equal(response.data, null);
    assert.equal(harness.jobs.get(userId).claim_token, 'original-token');
    assert.equal(harness.jobs.get(userId).receipt_hash, original.receipt_hash);
    assert.equal(harness.jobs.get(userId).state, 'in_progress');
  }
  assert.throws(
    () => applyClaim(null, {
      userId,
      receiptHash: hashReceipt(RECEIPT),
      claimToken: 'token',
      storagePrefix: 'profile-pictures/x',
      staleSeconds: null,
    }, Date.now()),
    /invalid stale lease duration/,
  );
  assert.equal(harness.jobs.size, 1);
});

test('two observers of one fresh claim do not both receive it', () => {
  const now = Date.now();
  const existing = unfinishedJob('user-1', {
    claim_token: 'original-token',
    claimed_at: new Date(now).toISOString(),
  });
  const input = {
    userId: 'user-1',
    receiptHash: hashReceipt(RECEIPT),
    storagePrefix: 'profile-pictures/user-1',
    staleSeconds: 300,
  };
  const first = applyClaim(existing, { ...input, claimToken: 'claim-a' }, now);
  const second = applyClaim(existing, { ...input, claimToken: 'claim-b' }, now);
  assert.equal(first.claimed, false);
  assert.equal(second.claimed, false);
  assert.equal(first.reason, 'in_progress');
  assert.equal(second.reason, 'in_progress');
  assert.equal(existing.claim_token, 'original-token');

  const created = applyClaim(null, { ...input, claimToken: 'claim-created' }, now);
  const follower = applyClaim(created.job, { ...input, claimToken: 'claim-follower' }, now);
  assert.equal(created.claimed, true);
  assert.equal(follower.claimed, false);
  assert.equal(follower.reason, 'in_progress');
});

test('a receipt owned by another account returns a controlled error', async () => {
  const ownerId = randomUUID();
  const otherId = randomUUID();
  const harness = createHarness({ authUsers: [ownerId, otherId] });
  const receiptHash = hashReceipt(RECEIPT);
  const ownerToken = randomUUID();
  harness.profiles.set(otherId, appleProfile(otherId));
  harness.jobs.set(ownerId, unfinishedJob(ownerId, {
    claim_token: ownerToken,
    receipt_hash: receiptHash,
    state: 'in_progress',
  }));
  const outcome = await harness.service.deleteAccount({ userId: otherId, receipt: RECEIPT });
  assert.equal(outcome.httpStatus, 409);
  assert.equal(outcome.body.code, 'deletion_receipt_in_use');
  assert.match(outcome.body.error, /contact support/);
  assert.equal(harness.calls.deleteUser.length, 0);
  assert.equal(harness.jobs.has(otherId), false);
  assert.equal(harness.jobs.get(ownerId).user_id, ownerId);
  assert.equal(harness.jobs.get(ownerId).receipt_hash, receiptHash);
  assert.equal(harness.jobs.get(ownerId).claim_token, ownerToken);
  assert.equal(harness.jobs.get(ownerId).state, 'in_progress');
  const body = JSON.stringify(outcome.body);
  assert.equal(body.includes(ownerId), false);
  assert.equal(body.includes(otherId), false);
  assert.equal(body.includes(receiptHash), false);
});

test('an expired status check does not change an unfinished job', async () => {
  const userId = randomUUID();
  let clock = Date.now();
  const harness = createHarness({ now: () => clock });
  const receiptHash = hashReceipt(RECEIPT);
  const token = randomUUID();
  harness.jobs.set(userId, unfinishedJob(userId, {
    claim_token: token,
    receipt_hash: receiptHash,
    state: 'blocked',
    expires_at: new Date(clock - 1000).toISOString(),
  }));
  const status = await harness.service.getStatus(RECEIPT, '203.0.113.20');
  assert.deepEqual(status.body, { state: 'unknown' });
  assert.equal(harness.jobs.get(userId).user_id, userId);
  assert.equal(harness.jobs.get(userId).receipt_hash, receiptHash);
  assert.equal(harness.jobs.get(userId).claim_token, token);
  assert.equal(harness.jobs.get(userId).state, 'blocked');
});

test('a missing receipt asks for an app update and does not delete', async () => {
  const userId = randomUUID();
  const harness = createHarness({ authUsers: [userId] });
  harness.profiles.set(userId, appleProfile(userId));
  for (const receipt of [undefined, null, '', '   ']) {
    const outcome = await harness.service.deleteAccount({ userId, receipt });
    assert.equal(outcome.httpStatus, 426);
    assert.equal(outcome.body.code, 'app_update_required');
    assert.match(outcome.body.error, /Update Primal Male/);
  }
  assert.equal(harness.calls.deleteUser.length, 0);
  assert.equal(harness.jobs.size, 0);
  const invalid = await harness.service.deleteAccount({ userId, receipt: 'short' });
  assert.equal(invalid.httpStatus, 400);
  assert.equal(invalid.body.code, 'invalid_receipt');
});

test('deletion fails closed without the service-role key', async () => {
  const userId = randomUUID();
  const harness = createHarness({ authUsers: [userId], serviceRoleConfigured: false });
  harness.profiles.set(userId, appleProfile(userId));
  const outcome = await harness.service.deleteAccount({ userId, receipt: RECEIPT });
  assert.equal(outcome.httpStatus, 503);
  assert.equal(outcome.body.code, 'deletion_unconfigured');
  assert.equal(harness.calls.deleteUser.length, 0);
  assert.equal(harness.jobs.size, 0);
  const sweep = await harness.service.sweepStorage('sweep-token');
  assert.equal(sweep.httpStatus, 503);
  assert.equal(sweep.body.code, 'deletion_unconfigured');
});

test('a permission error is not treated as a missing deletion table', () => {
  assert.equal(isMissingDeletionStore({
    code: '42501',
    message: 'permission denied for table deletion_jobs',
  }), false);
  assert.equal(isMissingDeletionStore({
    code: 'PGRST205',
    message: "Could not find the table 'public.deletion_jobs' in the schema cache",
  }), true);
});
