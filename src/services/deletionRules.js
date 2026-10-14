import { createHash, timingSafeEqual } from 'node:crypto';

export const STALE_CLAIM_MS = 5 * 60 * 1000;
export const STALE_CLAIM_SECONDS = STALE_CLAIM_MS / 1000;
export const MIN_STALE_CLAIM_SECONDS = 60;
export const MAX_STALE_CLAIM_SECONDS = 600;
export const RECEIPT_TTL_MS = 24 * 60 * 60 * 1000;
export const STATUS_RATE_LIMIT = 30;
export const STATUS_RATE_WINDOW_MS = 15 * 60 * 1000;
const RECEIPT_PATTERN = /^[A-Za-z0-9_-]{43,128}$/;

export const DELETION_IN_PROGRESS_MESSAGE =
  'Account deletion is in progress. You can retry deletion, sign out, or contact support.';

export function isValidReceipt(receipt) {
  return typeof receipt === 'string' && RECEIPT_PATTERN.test(receipt);
}

export function hashReceipt(receipt) {
  return createHash('sha256').update(String(receipt)).digest('hex');
}

export function tokensMatch(provided, expected) {
  const left = Buffer.from(String(provided || ''));
  const right = Buffer.from(String(expected || ''));
  if (left.length === 0 || left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export function shouldBlockAuthenticatedRoute(path, job) {
  if (!job) return false;
  if (path === '/auth/delete-account' || path === '/auth/signout') return false;
  return job.state === 'in_progress' || job.state === 'blocked';
}

export function deletionStatusForJob(job, now) {
  if (!job?.expires_at) return 'unknown';
  if (new Date(job.expires_at).getTime() <= now) return 'unknown';
  if (job.state === 'completed') return 'completed';
  if (job.state === 'in_progress' || job.state === 'blocked') return 'pending';
  return 'unknown';
}

export function canRemoveDeletionJob(job, now) {
  if (!job) return false;
  if (job.state !== 'completed') return false;
  if (job.storage_status !== 'settled') return false;
  if (!job.expires_at) return false;
  return new Date(job.expires_at).getTime() <= now;
}

export function isMissingDeletionStore(error) {
  const code = String(error?.code || '');
  const message = `${error?.message || ''} ${error?.details || ''}`.toLowerCase();
  if (code === '42501' || message.includes('permission denied')) return false;
  const namesStore = message.includes('deletion_jobs')
    || message.includes('claim_deletion_job')
    || message.includes('delete_account_blockers');
  return code === '42P01'
    || code === 'PGRST205'
    || message.includes('could not find the table')
    || (namesStore && message.includes('does not exist'));
}

export function isAuthUserMissing(user, error) {
  if (user) return false;
  if (!error) return true;
  const status = error.status || error.statusCode;
  const code = String(error.code || '');
  const message = String(error.message || '').toLowerCase();
  return status === 404 || code === 'user_not_found' || message.includes('not found');
}

export function isStripeMissing(error) {
  return error?.code === 'resource_missing' || error?.raw?.code === 'resource_missing';
}

export function consumeRateLimit(bucket, key, now, limit, windowMs) {
  const previous = bucket.get(key) || [];
  const fresh = previous.filter((timestamp) => now - timestamp < windowMs);
  if (fresh.length >= limit) {
    bucket.set(key, fresh);
    return false;
  }
  fresh.push(now);
  bucket.set(key, fresh);
  return true;
}

export function assertValidStaleSeconds(staleSeconds) {
  if (!Number.isInteger(staleSeconds)
    || staleSeconds < MIN_STALE_CLAIM_SECONDS
    || staleSeconds > MAX_STALE_CLAIM_SECONDS) {
    const error = new Error('invalid stale lease duration');
    error.code = '22023';
    throw error;
  }
}

export function otherUserOwnsReceipt(jobs, userId, receiptHash) {
  return jobs.some((job) => job.user_id !== userId && job.receipt_hash === receiptHash);
}

function unchangedClaim(existing, reason) {
  return {
    claimed: false,
    reason,
    claim_token: null,
    state: existing.state,
    job: existing,
  };
}

/**
 * In-memory form of public.claim_deletion_job.
 * Production serialization is the SQL function. Tests use this so the rules stay explicit.
 * Invalid lease durations throw before a job object is created or copied.
 */
export function applyClaim(existing, input, now) {
  const staleSeconds = Object.hasOwn(input, 'staleSeconds')
    ? input.staleSeconds
    : STALE_CLAIM_SECONDS;
  assertValidStaleSeconds(staleSeconds);
  const staleBefore = now - staleSeconds * 1000;

  if (!existing) {
    return {
      claimed: true,
      reason: 'created',
      claim_token: input.claimToken,
      state: 'in_progress',
      job: {
        user_id: input.userId,
        receipt_hash: input.receiptHash,
        claim_token: input.claimToken,
        claimed_at: new Date(now).toISOString(),
        state: 'in_progress',
        stripe_status: 'unknown',
        storage_status: 'not_required',
        stripe_customer_id: input.stripeCustomerId || null,
        storage_prefix: input.storagePrefix,
        last_error: null,
        expires_at: new Date(now + RECEIPT_TTL_MS).toISOString(),
        created_at: new Date(now).toISOString(),
      },
    };
  }

  const claimedAt = existing.claimed_at ? new Date(existing.claimed_at).getTime() : 0;
  const fresh = claimedAt > staleBefore;
  const sameReceipt = existing.receipt_hash === input.receiptHash;

  if (existing.state === 'completed') {
    return unchangedClaim(existing, sameReceipt ? 'already_completed' : 'receipt_mismatch');
  }

  if (!sameReceipt) {
    return unchangedClaim(existing, 'receipt_mismatch');
  }

  if (existing.state === 'in_progress' && fresh) {
    return unchangedClaim(existing, 'in_progress');
  }

  const job = {
    ...existing,
    claim_token: input.claimToken,
    claimed_at: new Date(now).toISOString(),
    state: 'in_progress',
    storage_prefix: input.storagePrefix,
    stripe_customer_id: input.stripeCustomerId ?? existing.stripe_customer_id,
    last_error: null,
    expires_at: new Date(now + RECEIPT_TTL_MS).toISOString(),
  };

  return { claimed: true, reason: 'reclaimed', claim_token: input.claimToken, state: 'in_progress', job };
}
