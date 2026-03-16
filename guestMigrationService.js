import { supabaseAdmin } from "./supabaseClient.js";

const MAX_DATE_ROWS = 60;

const MISSION_FIELDS = [
  "sleep_completed",
  "exercise_completed",
  "sunlight_completed",
  "diet_completed",
  "alcohol_avoided",
  "cold_exposure_completed",
  "no_porn_masturbation",
];

const VALID_REPORT_DAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

const VALID_PERSONALITIES = [
  "balanced",
  "drill_sergeant",
  "supportive_mentor",
  "data_analyst",
];

const isNonEmpty = (value) => {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value).length > 0;
  return true;
};

const isStrictDate = (value) => {
  if (typeof value !== "string") return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return false;
  return date.toISOString().startsWith(value);
};

const requireObject = (value, name) => {
  if (value === undefined || value === null) return {};
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${name} must be an object`);
  }
  return value;
};

const normalizeMissionRow = (row, index) => {
  const missionRow = requireObject(row, `dailyMissions[${index}]`);
  if (!isStrictDate(missionRow.date)) {
    throw new Error(`dailyMissions[${index}].date must be YYYY-MM-DD`);
  }

  const normalized = { date: missionRow.date };
  for (const field of MISSION_FIELDS) {
    normalized[field] = Boolean(missionRow[field]);
  }
  return normalized;
};

const normalizeHealthDataEntry = (entry) => {
  if (!entry || typeof entry !== "object") return null;
  const label = typeof entry.label === "string" ? entry.label.trim() : "";
  const icon = typeof entry.icon === "string" ? entry.icon.trim() : "";
  const color = typeof entry.color === "string" ? entry.color.trim() : "";

  let numeric = Number(entry.numericValue ?? entry.value);
  if (!Number.isFinite(numeric)) {
    const parsed = parseFloat(String(entry.value ?? ""));
    numeric = Number.isFinite(parsed) ? parsed : NaN;
  }
  if (!label || !Number.isFinite(numeric)) return null;

  return {
    label,
    value: String(Number(numeric.toFixed(2))),
    icon: icon || "sparkles-outline",
    color: color || "#EF4444",
  };
};

const normalizeProgressRow = (row, index) => {
  const progressRow = requireObject(row, `progress[${index}]`);
  if (!isStrictDate(progressRow.date)) {
    throw new Error(`progress[${index}].date must be YYYY-MM-DD`);
  }

  const rawHealthData = Array.isArray(progressRow.health_data)
    ? progressRow.health_data
    : Array.isArray(progressRow.healthData)
      ? progressRow.healthData
      : [];

  const healthData = rawHealthData
    .map(normalizeHealthDataEntry)
    .filter(Boolean)
    .slice(0, 20);

  return {
    date: progressRow.date,
    health_data: healthData,
  };
};

const mergeMissionFields = (existing, incoming) => {
  const merged = {};
  for (const field of MISSION_FIELDS) {
    merged[field] = isNonEmpty(existing?.[field]) ? existing[field] : incoming[field];
  }
  return merged;
};

const missionRowsEqual = (a, b) =>
  MISSION_FIELDS.every((field) => Boolean(a?.[field]) === Boolean(b?.[field]));

const mergeProgressRow = (existing, incoming) => {
  if (Array.isArray(existing?.health_data) && existing.health_data.length > 0) {
    return existing.health_data;
  }
  return incoming.health_data;
};

const fetchExistingByDate = async (table, userId, dates, selectColumns) => {
  if (!dates.length) return [];
  const { data, error } = await supabaseAdmin
    .from(table)
    .select(selectColumns)
    .eq("user_id", userId)
    .in("date", dates);
  if (error) throw error;
  return data || [];
};

const upsertDailyMissions = async (userId, dailyMissions) => {
  const stats = {
    missionsInserted: 0,
    missionsUpdated: 0,
    missionsSkipped: 0,
  };

  if (!dailyMissions.length) return stats;

  const uniqueByDate = new Map(dailyMissions.map((row) => [row.date, row]));
  const dates = [...uniqueByDate.keys()];
  const existingRows = await fetchExistingByDate(
    "daily_missions",
    userId,
    dates,
    `date, ${MISSION_FIELDS.join(",")}`,
  );
  const existingByDate = new Map(existingRows.map((row) => [row.date, row]));
  const upsertRows = [];

  for (const date of dates) {
    const incoming = uniqueByDate.get(date);
    const existing = existingByDate.get(date);
    const merged = mergeMissionFields(existing, incoming);

    if (!existing) {
      stats.missionsInserted += 1;
      upsertRows.push({ user_id: userId, date, ...merged });
      continue;
    }

    if (!missionRowsEqual(existing, merged)) {
      stats.missionsUpdated += 1;
      upsertRows.push({ user_id: userId, date, ...merged });
    } else {
      stats.missionsSkipped += 1;
    }
  }

  if (upsertRows.length > 0) {
    const { error } = await supabaseAdmin.from("daily_missions").upsert(upsertRows, {
      onConflict: "user_id,date",
    });
    if (error) throw error;
  }

  return stats;
};

const upsertProgress = async (userId, progressRows) => {
  const stats = {
    progressInserted: 0,
    progressUpdated: 0,
    progressSkipped: 0,
  };

  if (!progressRows.length) return stats;

  const uniqueByDate = new Map(progressRows.map((row) => [row.date, row]));
  const dates = [...uniqueByDate.keys()];
  const existingRows = await fetchExistingByDate(
    "progress",
    userId,
    dates,
    "date, health_data",
  );
  const existingByDate = new Map(existingRows.map((row) => [row.date, row]));
  const upsertRows = [];

  for (const date of dates) {
    const incoming = uniqueByDate.get(date);
    if (!incoming.health_data.length) {
      stats.progressSkipped += 1;
      continue;
    }

    const existing = existingByDate.get(date);
    const mergedHealthData = mergeProgressRow(existing, incoming);
    const shouldUpdate =
      !existing ||
      JSON.stringify(existing.health_data || []) !== JSON.stringify(mergedHealthData || []);

    if (!existing) stats.progressInserted += 1;
    else if (shouldUpdate) stats.progressUpdated += 1;
    else {
      stats.progressSkipped += 1;
      continue;
    }

    upsertRows.push({
      user_id: userId,
      date,
      health_data: mergedHealthData,
      updated_at: new Date().toISOString(),
    });
  }

  if (upsertRows.length > 0) {
    const { error } = await supabaseAdmin.from("progress").upsert(upsertRows, {
      onConflict: "user_id,date",
    });
    if (error) throw error;
  }

  return stats;
};

const updateProfileFromGuestPayload = async (userId, payload) => {
  let profileUpdated = false;
  const { data: existingProfile, error: profileError } = await supabaseAdmin
    .from("user_profiles")
    .select("id, onboarding_data, units_preference")
    .eq("id", userId)
    .maybeSingle();
  if (profileError) throw profileError;

  const profilePatch = {};
  if (!existingProfile?.id) profilePatch.id = userId;

  if (!isNonEmpty(existingProfile?.onboarding_data) && isNonEmpty(payload.onboardingData)) {
    profilePatch.onboarding_data = payload.onboardingData;
    profileUpdated = true;
  }

  if (
    !isNonEmpty(existingProfile?.units_preference) &&
    ["metric", "imperial"].includes(payload.unitsPreference)
  ) {
    profilePatch.units_preference = payload.unitsPreference;
    profileUpdated = true;
  }

  if (Object.keys(profilePatch).length > 0) {
    const { error } = await supabaseAdmin.from("user_profiles").upsert([profilePatch], {
      onConflict: "id",
    });
    if (error) throw error;
  }

  // Try to persist AI coach settings if optional columns exist.
  if (payload.aiCoachSettings) {
    const reportDay = payload.aiCoachSettings.reportDay;
    const personality = payload.aiCoachSettings.personality;
    if (
      VALID_REPORT_DAYS.includes(reportDay) &&
      VALID_PERSONALITIES.includes(personality)
    ) {
      const { error } = await supabaseAdmin
        .from("user_profiles")
        .update({
          ai_coach_report_day: reportDay,
          ai_coach_personality: personality,
        })
        .eq("id", userId);
      if (error && !String(error.message || "").includes("ai_coach_")) {
        throw error;
      }
      if (!error) profileUpdated = true;
    }
  }

  return { profileUpdated };
};

export const validateGuestMigrationPayload = (rawPayload) => {
  const payload = requireObject(rawPayload || {}, "payload");
  const onboardingData = requireObject(payload.onboardingData, "onboardingData");
  const aiCoachSettings = requireObject(payload.aiCoachSettings, "aiCoachSettings");
  const unitsPreference = payload.unitsPreference;
  const trialStartedAt = payload.trialStartedAt;

  const rawDailyMissions = Array.isArray(payload.dailyMissions) ? payload.dailyMissions : [];
  const rawProgress = Array.isArray(payload.progress) ? payload.progress : [];

  if (rawDailyMissions.length > MAX_DATE_ROWS) {
    throw new Error(`dailyMissions exceeds ${MAX_DATE_ROWS} rows`);
  }
  if (rawProgress.length > MAX_DATE_ROWS) {
    throw new Error(`progress exceeds ${MAX_DATE_ROWS} rows`);
  }

  if (unitsPreference && !["metric", "imperial"].includes(unitsPreference)) {
    throw new Error("unitsPreference must be metric or imperial");
  }

  if (trialStartedAt !== undefined && !Number.isFinite(Number(trialStartedAt))) {
    throw new Error("trialStartedAt must be a number");
  }

  if (
    aiCoachSettings.reportDay &&
    !VALID_REPORT_DAYS.includes(aiCoachSettings.reportDay)
  ) {
    throw new Error("aiCoachSettings.reportDay is invalid");
  }

  if (
    aiCoachSettings.personality &&
    !VALID_PERSONALITIES.includes(aiCoachSettings.personality)
  ) {
    throw new Error("aiCoachSettings.personality is invalid");
  }

  const dailyMissions = rawDailyMissions.map(normalizeMissionRow);
  const progress = rawProgress.map(normalizeProgressRow);

  return {
    onboardingData,
    dailyMissions,
    progress,
    aiCoachSettings,
    unitsPreference,
    trialStartedAt: trialStartedAt !== undefined ? Number(trialStartedAt) : undefined,
  };
};

export const migrateGuestDataToUser = async (userId, rawPayload) => {
  const payload = validateGuestMigrationPayload(rawPayload);

  const missionStats = await upsertDailyMissions(userId, payload.dailyMissions);
  const progressStats = await upsertProgress(userId, payload.progress);
  const profileStats = await updateProfileFromGuestPayload(userId, payload);

  return {
    migrated: true,
    stats: {
      ...missionStats,
      ...progressStats,
      profileUpdated: Boolean(profileStats.profileUpdated),
    },
  };
};
