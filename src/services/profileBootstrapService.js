import { supabaseAdmin } from '../config/supabase.js';

export const ensureUserProfile = async (userId) => {
  const { error } = await supabaseAdmin
    .from('user_profiles')
    .upsert(
      [{ id: userId, updated_at: new Date().toISOString() }],
      { onConflict: 'id', ignoreDuplicates: true }
    );

  if (error) throw error;
};

export const recordGuestTrialStartedAt = async (userId, guestTrialStartedAtMs) => {
  const ms = Number(guestTrialStartedAtMs);
  if (!Number.isFinite(ms) || ms <= 0) {
    return { recorded: false };
  }

  await ensureUserProfile(userId);

  const { data: profile, error: fetchError } = await supabaseAdmin
    .from('user_profiles')
    .select('guest_trial_started_at')
    .eq('id', userId)
    .maybeSingle();

  if (fetchError) throw fetchError;
  if (profile?.guest_trial_started_at) {
    return { recorded: false, alreadySet: true };
  }

  const startedAt = new Date(ms).toISOString();
  const { error: updateError } = await supabaseAdmin
    .from('user_profiles')
    .update({
      guest_trial_started_at: startedAt,
      updated_at: new Date().toISOString(),
    })
    .eq('id', userId);

  if (updateError) throw updateError;
  return { recorded: true, guest_trial_started_at: startedAt };
};
