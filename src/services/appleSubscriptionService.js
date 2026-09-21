import { decodeProtectedHeader, importX509, jwtVerify, decodeJwt } from 'jose';
import { supabaseAdmin } from '../config/supabase.js';
import { ensureUserProfile } from './profileBootstrapService.js';

const EXPECTED_PRODUCT_ID =
  process.env.APPLE_IAP_PRODUCT_ID || 'com.easysahal.primalmale.pro.monthly';

const ACTIVE_STATUSES = new Set(['active', 'trialing']);

const decodeJwsPayload = (jws) => {
  if (!jws || typeof jws !== 'string' || jws.split('.').length < 2) {
    throw new Error('Invalid Apple JWS');
  }
  return decodeJwt(jws);
};

const verifyAppleJws = async (jws) => {
  const header = decodeProtectedHeader(jws);
  const x5c = header.x5c;
  if (!Array.isArray(x5c) || !x5c.length) {
    // Fall back to decode-only when cert chain is missing (rare)
    console.warn('Apple JWS missing x5c; decoding without signature verify');
    return decodeJwsPayload(jws);
  }

  const pem = `-----BEGIN CERTIFICATE-----\n${x5c[0]}\n-----END CERTIFICATE-----`;
  const key = await importX509(pem, header.alg || 'ES256');
  const { payload } = await jwtVerify(jws, key);
  return payload;
};

const mapAppleStatus = (payload) => {
  const expiresMs = Number(payload.expiresDate || payload.expires_date || 0);
  const now = Date.now();
  if (payload.revocationDate || payload.revocation_date) {
    return 'canceled';
  }
  if (expiresMs && expiresMs <= now) {
    return 'expired';
  }
  if (payload.offerDiscountType === 'FREE_TRIAL' || payload.offerType === 1) {
    return 'trialing';
  }
  return 'active';
};

const normalizeTransaction = (payload) => {
  const productId = payload.productId || payload.product_id;
  const originalTransactionId =
    payload.originalTransactionId || payload.original_transaction_id;
  const transactionId = payload.transactionId || payload.transaction_id;
  const expiresMs = Number(payload.expiresDate || payload.expires_date || 0);
  const environment = payload.environment || null;

  if (!productId || !originalTransactionId || !transactionId) {
    throw new Error('Apple transaction missing required fields');
  }

  if (productId !== EXPECTED_PRODUCT_ID) {
    throw new Error(`Unexpected Apple product id: ${productId}`);
  }

  return {
    productId,
    originalTransactionId,
    transactionId,
    expiresAt: expiresMs ? new Date(expiresMs).toISOString() : null,
    environment,
    status: mapAppleStatus(payload),
    payload,
  };
};

export const applyAppleEntitlement = async (userId, transaction) => {
  await ensureUserProfile(userId);

  const { error } = await supabaseAdmin
    .from('user_profiles')
    .update({
      billing_provider: 'apple',
      apple_original_transaction_id: transaction.originalTransactionId,
      apple_transaction_id: transaction.transactionId,
      apple_product_id: transaction.productId,
      apple_expires_at: transaction.expiresAt,
      apple_environment: transaction.environment,
      subscription_status: transaction.status,
      subscription_id: transaction.originalTransactionId,
      updated_at: new Date().toISOString(),
    })
    .eq('id', userId);

  if (error) throw error;
  return transaction;
};

export const verifyApplePurchaseForUser = async (userId, signedTransactionInfo) => {
  if (!signedTransactionInfo) {
    throw new Error('signedTransactionInfo is required');
  }

  const payload = await verifyAppleJws(signedTransactionInfo);
  const transaction = normalizeTransaction(payload);

  // If another account already owns this original transaction, block linking
  const { data: existingOwner, error: ownerError } = await supabaseAdmin
    .from('user_profiles')
    .select('id')
    .eq('apple_original_transaction_id', transaction.originalTransactionId)
    .maybeSingle();

  if (ownerError && ownerError.code !== 'PGRST116') throw ownerError;
  if (existingOwner?.id && existingOwner.id !== userId) {
    throw new Error('This Apple subscription is already linked to another account');
  }

  await applyAppleEntitlement(userId, transaction);
  return {
    status: transaction.status,
    provider: 'apple',
    subscription: {
      id: transaction.originalTransactionId,
      productId: transaction.productId,
      expiresAt: transaction.expiresAt,
      environment: transaction.environment,
    },
  };
};

export const handleAppleServerNotification = async (signedPayload) => {
  const notification = await verifyAppleJws(signedPayload);
  const signedTransactionInfo =
    notification.data?.signedTransactionInfo ||
    notification.data?.signedRenewalInfo;

  if (!notification.data?.signedTransactionInfo) {
    console.warn('Apple notification without signedTransactionInfo', notification.notificationType);
    return { handled: false };
  }

  const payload = await verifyAppleJws(notification.data.signedTransactionInfo);
  const transaction = normalizeTransaction(payload);

  const { data: profile, error } = await supabaseAdmin
    .from('user_profiles')
    .select('id')
    .eq('apple_original_transaction_id', transaction.originalTransactionId)
    .maybeSingle();

  if (error && error.code !== 'PGRST116') throw error;
  if (!profile?.id) {
    console.warn(
      'Apple notification for unknown originalTransactionId:',
      transaction.originalTransactionId
    );
    return { handled: false };
  }

  // Notification types that revoke access
  const type = String(notification.notificationType || '').toUpperCase();
  if (['EXPIRED', 'REVOKE', 'REFUND', 'GRACE_PERIOD_EXPIRED'].includes(type)) {
    transaction.status = 'expired';
  } else if (['DID_FAIL_TO_RENEW'].includes(type)) {
    // Keep current until expiresAt; still update fields
  }

  await applyAppleEntitlement(profile.id, transaction);
  return { handled: true, userId: profile.id, type, status: transaction.status };
};

export const getAppleSubscriptionStatus = async (userId) => {
  const { data: profile, error } = await supabaseAdmin
    .from('user_profiles')
    .select(
      'billing_provider, subscription_status, apple_original_transaction_id, apple_product_id, apple_expires_at, apple_environment, apple_transaction_id'
    )
    .eq('id', userId)
    .maybeSingle();

  if (error && error.code !== 'PGRST116') throw error;
  if (!profile || profile.billing_provider !== 'apple') {
    return null;
  }

  let status = profile.subscription_status || 'no_subscription';
  if (profile.apple_expires_at) {
    const expiresAt = new Date(profile.apple_expires_at);
    if (expiresAt.getTime() <= Date.now() && ACTIVE_STATUSES.has(status)) {
      status = 'expired';
      await supabaseAdmin
        .from('user_profiles')
        .update({
          subscription_status: status,
          updated_at: new Date().toISOString(),
        })
        .eq('id', userId);
    }
  }

  return {
    status,
    provider: 'apple',
    subscription: {
      id: profile.apple_original_transaction_id,
      productId: profile.apple_product_id,
      expiresAt: profile.apple_expires_at,
      environment: profile.apple_environment,
      transactionId: profile.apple_transaction_id,
    },
  };
};

export const isAppleAccessActive = (appleStatus) =>
  Boolean(appleStatus && ACTIVE_STATUSES.has(appleStatus.status));
