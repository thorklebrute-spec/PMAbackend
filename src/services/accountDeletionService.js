import {
  DELETION_IN_PROGRESS_MESSAGE,
  RECEIPT_TTL_MS,
  STALE_CLAIM_SECONDS,
  STATUS_RATE_LIMIT,
  STATUS_RATE_WINDOW_MS,
  canRemoveDeletionJob,
  consumeRateLimit,
  deletionStatusForJob,
  hashReceipt,
  isAuthUserMissing,
  isStripeMissing,
  isValidReceipt,
  tokensMatch,
} from './deletionRules.js';

const SUPPORT_HINT = 'You can retry deletion, sign out, or contact support.';

function result(httpStatus, body) {
  return { httpStatus, body };
}

async function listPage(query) {
  const { data, error } = await query;
  if (error) throw error;
  return data;
}

export function createAccountDeletionService(deps) {
  const supabase = deps.supabaseAdmin;
  const stripe = deps.stripe;
  const now = deps.now || (() => Date.now());
  const sweepToken = deps.sweepToken || (() => process.env.DELETION_SWEEP_TOKEN || '');
  const stripePageSize = deps.stripePageSize || 100;
  const storagePageSize = deps.storagePageSize || 100;
  const rateBucket = deps.rateBucket || new Map();
  const rateLimit = deps.rateLimit ?? STATUS_RATE_LIMIT;
  const rateWindowMs = deps.rateWindowMs ?? STATUS_RATE_WINDOW_MS;
  const serviceRoleConfigured = deps.serviceRoleConfigured !== false;

  function unavailable() {
    return result(503, {
      error: 'Account deletion is unavailable. You can sign out or contact support.',
      code: 'deletion_unconfigured',
    });
  }

  function privilegedReady() {
    return serviceRoleConfigured && supabase;
  }

  async function updateOwned(userId, claimToken, patch) {
    const { data, error } = await supabase
      .from('deletion_jobs')
      .update({ ...patch, updated_at: new Date(now()).toISOString() })
      .eq('user_id', userId)
      .eq('claim_token', claimToken)
      .select('user_id');
    if (error) throw error;
    return Array.isArray(data) && data.length > 0;
  }

  async function renewLease(userId, claimToken) {
    return updateOwned(userId, claimToken, {
      claimed_at: new Date(now()).toISOString(),
    });
  }

  async function loadOwnedJob(userId, claimToken) {
    const { data, error } = await supabase
      .from('deletion_jobs')
      .select('user_id, receipt_hash, claim_token, state, stripe_status, storage_status, stripe_customer_id, storage_prefix, expires_at')
      .eq('user_id', userId)
      .eq('claim_token', claimToken)
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  async function cancelStripeForCustomer(customerId, userId, claimToken) {
    let startingAfter;
    const seenCursors = new Set();
    for (;;) {
      if (claimToken && !(await renewLease(userId, claimToken))) {
        const lost = new Error('deletion claim lost during Stripe cancellation');
        lost.code = 'deletion_claim_lost';
        throw lost;
      }
      const page = await stripe.subscriptions.list({
        customer: customerId,
        status: 'all',
        limit: stripePageSize,
        ...(startingAfter ? { starting_after: startingAfter } : {}),
      });
      const subscriptions = page.data || [];
      for (const subscription of subscriptions) {
        if (['canceled', 'incomplete_expired'].includes(subscription.status)) continue;
        try {
          await stripe.subscriptions.cancel(subscription.id, {}, {
            idempotencyKey: `account-deletion-${userId}-${subscription.id}`,
          });
        } catch (error) {
          if (!isStripeMissing(error)) throw error;
        }
      }
      if (page.has_more !== true || subscriptions.length === 0) break;
      const cursor = subscriptions[subscriptions.length - 1].id;
      if (seenCursors.has(cursor)) break;
      seenCursors.add(cursor);
      startingAfter = cursor;
    }
  }

  async function removeProfilePictures(userId, claimToken = null) {
    const folder = `profile-pictures/${userId}`;
    const bucket = supabase.storage.from('user-uploads');
    const paths = [];
    const seenPages = new Set();
    let offset = 0;
    for (;;) {
      if (claimToken && !(await renewLease(userId, claimToken))) {
        const lost = new Error('deletion claim lost during storage cleanup');
        lost.code = 'deletion_claim_lost';
        throw lost;
      }
      const { data, error } = await bucket.list(folder, { limit: storagePageSize, offset });
      if (error) throw error;
      const entries = data || [];
      const pageKey = entries.map((entry) => entry?.name || '').join('\0');
      if (seenPages.has(pageKey)) break;
      seenPages.add(pageKey);
      for (const entry of entries) {
        if (entry?.id && entry.name && entry.name !== '.emptyFolderPlaceholder') {
          paths.push(`${folder}/${entry.name}`);
        }
      }
      if (entries.length < storagePageSize) break;
      offset += entries.length;
    }
    for (let index = 0; index < paths.length; index += storagePageSize) {
      if (claimToken && !(await renewLease(userId, claimToken))) {
        const lost = new Error('deletion claim lost during storage cleanup');
        lost.code = 'deletion_claim_lost';
        throw lost;
      }
      const batch = paths.slice(index, index + storagePageSize);
      const { error: removeError } = await bucket.remove(batch);
      if (removeError) throw removeError;
    }
  }

  async function blockOwned(userId, claimToken, code, message) {
    await updateOwned(userId, claimToken, {
      state: 'blocked',
      last_error: code,
    });
    return result(503, { error: message, code });
  }

  async function deleteAccount({ userId, receipt }) {
    if (!privilegedReady()) return unavailable();
    if (receipt == null || (typeof receipt === 'string' && receipt.trim() === '')) {
      return result(426, {
        error: 'Update Primal Male to the latest TestFlight or App Store version before deleting your account. You can sign out or contact support.',
        code: 'app_update_required',
      });
    }
    if (!isValidReceipt(receipt)) {
      return result(400, { error: 'A valid deletion receipt is required', code: 'invalid_receipt' });
    }

    const receiptHash = hashReceipt(receipt);
    const { data: claim, error: claimError } = await supabase.rpc('claim_deletion_job', {
      p_user_id: userId,
      p_receipt_hash: receiptHash,
      p_storage_prefix: `profile-pictures/${userId}`,
      p_stripe_customer_id: null,
      p_stale_seconds: STALE_CLAIM_SECONDS,
    });
    if (claimError) throw claimError;
    if (claim?.reason === 'receipt_in_use') {
      return result(409, {
        error: `This deletion request could not be started. ${SUPPORT_HINT}`,
        code: 'deletion_receipt_in_use',
      });
    }
    if (claim?.reason === 'already_completed') {
      return result(200, { success: true, code: 'already_completed' });
    }
    if (claim?.reason === 'receipt_mismatch') {
      return result(409, {
        error: `This deletion attempt does not match the one already in progress. ${SUPPORT_HINT}`,
        code: 'deletion_receipt_mismatch',
      });
    }
    if (!claim?.claimed) {
      return result(409, {
        error: DELETION_IN_PROGRESS_MESSAGE,
        code: 'deletion_in_progress',
      });
    }

    const claimToken = claim.claim_token;
    if (!(await renewLease(userId, claimToken))) {
      return result(409, {
        error: `Account deletion was taken over by a newer attempt. ${SUPPORT_HINT}`,
        code: 'deletion_claim_lost',
      });
    }

    const { data: profile, error: profileError } = await supabase
      .from('user_profiles')
      .select('billing_provider, stripe_customer_id')
      .eq('id', userId)
      .maybeSingle();
    if (profileError) {
      return blockOwned(
        userId,
        claimToken,
        'account_state_unreadable',
        `The account could not be read for deletion. ${SUPPORT_HINT}`,
      );
    }

    const stripeCustomerId = profile?.stripe_customer_id || null;
    if (stripeCustomerId) {
      try {
        await cancelStripeForCustomer(stripeCustomerId, userId, claimToken);
      } catch (error) {
        if (error.code === 'deletion_claim_lost') {
          return result(409, {
            error: `Account deletion was taken over by a newer attempt. ${SUPPORT_HINT}`,
            code: 'deletion_claim_lost',
          });
        }
        await updateOwned(userId, claimToken, { stripe_status: 'pending' });
        return blockOwned(
          userId,
          claimToken,
          'stripe_cancellation_failed',
          `The subscription could not be canceled yet. Your account was not deleted. ${SUPPORT_HINT}`,
        );
      }
      if (!(await updateOwned(userId, claimToken, {
        stripe_status: 'settled',
        stripe_customer_id: stripeCustomerId,
      }))) {
        return result(409, {
          error: `Account deletion was taken over by a newer attempt. ${SUPPORT_HINT}`,
          code: 'deletion_claim_lost',
        });
      }
    } else if (!(await updateOwned(userId, claimToken, { stripe_status: 'not_required' }))) {
      return result(409, {
        error: `Account deletion was taken over by a newer attempt. ${SUPPORT_HINT}`,
        code: 'deletion_claim_lost',
      });
    }

    if (!(await renewLease(userId, claimToken))) {
      return result(409, {
        error: `Account deletion was taken over by a newer attempt. ${SUPPORT_HINT}`,
        code: 'deletion_claim_lost',
      });
    }

    // delete_account_blockers commits before deleteUser. user_profiles and the
    // Apple transaction id stay until deleteUser commits. A missing public.users
    // row is not evidence that the auth user is gone.
    const { error: blockerError } = await supabase.rpc('delete_account_blockers', {
      p_user_id: userId,
    });
    if (blockerError) {
      return blockOwned(
        userId,
        claimToken,
        'deletion_cleanup_failed',
        `Account data could not be cleared yet. Your login was not deleted. ${SUPPORT_HINT}`,
      );
    }

    let storageFailed = false;
    try {
      await removeProfilePictures(userId, claimToken);
      if (!(await updateOwned(userId, claimToken, { storage_status: 'settled' }))) {
        return result(409, {
          error: `Account deletion was taken over by a newer attempt. ${SUPPORT_HINT}`,
          code: 'deletion_claim_lost',
        });
      }
    } catch (error) {
      if (error.code === 'deletion_claim_lost') {
        return result(409, {
          error: `Account deletion was taken over by a newer attempt. ${SUPPORT_HINT}`,
          code: 'deletion_claim_lost',
        });
      }
      storageFailed = true;
      await updateOwned(userId, claimToken, {
        storage_status: 'pending',
        last_error: 'storage_cleanup_failed',
      });
    }

    if (!(await renewLease(userId, claimToken))) {
      return result(409, {
        error: `Account deletion was taken over by a newer attempt. ${SUPPORT_HINT}`,
        code: 'deletion_claim_lost',
      });
    }

    const deleted = await supabase.auth.admin.deleteUser(userId);
    if (deleted?.error && !isAuthUserMissing(null, deleted.error)) {
      return blockOwned(
        userId,
        claimToken,
        'deletion_incomplete',
        `Account deletion did not finish. ${SUPPORT_HINT}`,
      );
    }

    const lookup = await supabase.auth.admin.getUserById(userId);
    const authUser = lookup?.data?.user || null;
    if (!isAuthUserMissing(authUser, lookup?.error)) {
      await updateOwned(userId, claimToken, {
        state: 'in_progress',
        last_error: 'deletion_incomplete',
      });
      return result(503, {
        error: `Account deletion did not finish. ${SUPPORT_HINT}`,
        code: 'deletion_incomplete',
      });
    }

    const completed = await updateOwned(userId, claimToken, {
      state: 'completed',
      last_error: storageFailed ? 'storage_cleanup_pending' : null,
    });
    if (!completed) {
      return result(409, {
        error: `Account deletion was taken over by a newer attempt. ${SUPPORT_HINT}`,
        code: 'deletion_claim_lost',
      });
    }

    return result(200, { success: true });
  }

  async function getStatus(receipt, ip = 'unknown') {
    const allowed = consumeRateLimit(rateBucket, String(ip || 'unknown'), now(), rateLimit, rateWindowMs);
    if (!allowed) {
      return result(429, {
        error: 'Too many deletion status checks. Try again later.',
        code: 'rate_limited',
      });
    }
    if (!privilegedReady()) return unavailable();
    if (!isValidReceipt(receipt)) {
      return result(200, { state: 'unknown' });
    }
    const { data, error } = await supabase
      .from('deletion_jobs')
      .select('state, expires_at')
      .eq('receipt_hash', hashReceipt(receipt))
      .maybeSingle();
    if (error) {
      return result(200, { state: 'unknown' });
    }
    return result(200, { state: deletionStatusForJob(data, now()) });
  }

  async function sweepStorage(token) {
    if (!privilegedReady()) return unavailable();
    const expected = sweepToken();
    if (!expected) {
      return result(503, {
        error: 'Storage cleanup sweep is not configured',
        code: 'sweep_not_configured',
      });
    }
    if (!tokensMatch(token, expected)) {
      return result(401, { error: 'Unauthorized', code: 'sweep_unauthorized' });
    }

    const { data, error } = await supabase
      .from('deletion_jobs')
      .select('user_id, claim_token, state, storage_status, storage_prefix, expires_at');
    if (error) throw error;

    let swept = 0;
    let pending = 0;
    let removed = 0;
    for (const job of data || []) {
      if (canRemoveDeletionJob(job, now())) {
        const { data: deletedRows, error: deleteError } = await supabase
          .from('deletion_jobs')
          .delete()
          .eq('user_id', job.user_id)
          .eq('state', 'completed')
          .eq('storage_status', 'settled')
          .select('user_id');
        if (!deleteError && Array.isArray(deletedRows) && deletedRows.length > 0) removed += 1;
        continue;
      }

      if (job.storage_status !== 'pending') continue;
      try {
        await removeProfilePictures(job.user_id);
        const owned = job.claim_token
          ? await updateOwned(job.user_id, job.claim_token, { storage_status: 'settled', last_error: null })
          : false;
        if (!owned) {
          const { error: updateError } = await supabase
            .from('deletion_jobs')
            .update({
              storage_status: 'settled',
              last_error: null,
              updated_at: new Date(now()).toISOString(),
            })
            .eq('user_id', job.user_id)
            .eq('storage_status', 'pending');
          if (updateError) throw updateError;
        }
        swept += 1;
      } catch (sweepError) {
        pending += 1;
        await supabase
          .from('deletion_jobs')
          .update({
            storage_status: 'pending',
            last_error: 'storage_cleanup_failed',
            updated_at: new Date(now()).toISOString(),
          })
          .eq('user_id', job.user_id)
          .eq('storage_status', 'pending');
        console.error('Pending storage deletion remains', {
          userId: job.user_id,
          code: 'storage_cleanup_failed',
        });
      }
    }

    return result(200, { swept, pending, removedReceipts: removed });
  }

  async function getBlockingJob(userId) {
    if (!privilegedReady()) {
      const error = new Error('SUPABASE_SERVICE_ROLE_KEY is not set');
      error.code = 'deletion_unconfigured';
      throw error;
    }
    const { data, error } = await supabase
      .from('deletion_jobs')
      .select('state')
      .eq('user_id', userId)
      .maybeSingle();
    if (error) {
      error.deletionStore = true;
      throw error;
    }
    return data;
  }

  return {
    deleteAccount,
    getStatus,
    sweepStorage,
    getBlockingJob,
    receiptTtlMs: RECEIPT_TTL_MS,
  };
}
