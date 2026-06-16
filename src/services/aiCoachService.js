import { supabaseAdmin } from '../config/supabase.js';
import { MISSION_FIELDS } from '../constants/missions.js';

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

const PERSONA_PROMPTS = {
  balanced:
    "Use practical, motivational coaching. Keep tone firm but supportive and specific.",
  drill_sergeant:
    "Use direct accountability tone. Be concise, strict, and action-focused without insults.",
  supportive_mentor:
    "Use encouraging, empathetic tone. Focus on progress and one-step improvement.",
  data_analyst:
    "Use metrics-first tone. Highlight trends, weak points, and actionable priorities.",
};

const DAY_INDEX = Object.fromEntries(
  VALID_REPORT_DAYS.map((day, index) => [day, index]),
);

const toDateOnly = (date) => date.toISOString().split("T")[0];

const formatWeekRange = (startDate, endDate) => {
  const format = (date) =>
    date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return `${format(startDate)} - ${format(endDate)}`;
};

const getReportWindow = (reportDay) => {
  const safeReportDay = VALID_REPORT_DAYS.includes(reportDay)
    ? reportDay
    : "Sunday";
  const today = new Date();
  const todayIdx = today.getDay();
  const reportIdx = DAY_INDEX[safeReportDay];
  const daysSinceReportDay =
    todayIdx >= reportIdx ? todayIdx - reportIdx : 7 - (reportIdx - todayIdx);

  const end = new Date(today);
  end.setDate(today.getDate() - daysSinceReportDay);

  const start = new Date(end);
  start.setDate(end.getDate() - 6);

  return {
    reportDay: safeReportDay,
    startDate: toDateOnly(start),
    endDate: toDateOnly(end),
    weekRange: formatWeekRange(start, end),
  };
};

const listWindowDates = (startDate, endDate) => {
  const dates = [];
  const cursor = new Date(startDate);
  const end = new Date(endDate);
  while (cursor <= end) {
    dates.push(toDateOnly(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return dates;
};

const calculateMissionSummary = (dailyMissionRows, startDate, endDate) => {
  const byDate = new Map(dailyMissionRows.map((row) => [row.date, row]));
  const dates = listWindowDates(startDate, endDate);

  let totalCompletedChecks = 0;
  const totalChecks = dates.length * MISSION_FIELDS.length;
  let fullyCompletedDays = 0;
  let runningStreak = 0;

  const missionTotals = Object.fromEntries(
    MISSION_FIELDS.map((field) => [field, 0]),
  );

  const normalizedDaily = dates.map((date) => {
    const row = byDate.get(date) || {};
    let completedCount = 0;
    const missionStates = {};
    for (const field of MISSION_FIELDS) {
      const done = Boolean(row[field]);
      missionStates[field] = done;
      if (done) {
        completedCount += 1;
        missionTotals[field] += 1;
      }
    }
    totalCompletedChecks += completedCount;
    const allDone = completedCount === MISSION_FIELDS.length;
    if (allDone) fullyCompletedDays += 1;
    return { date, completedCount, allDone, missions: missionStates };
  });

  for (let i = normalizedDaily.length - 1; i >= 0; i -= 1) {
    if (normalizedDaily[i].allDone) runningStreak += 1;
    else break;
  }

  const consistencyScore =
    totalChecks > 0 ? Math.round((totalCompletedChecks / totalChecks) * 100) : 0;
  const completionSummary = {
    completedDays: fullyCompletedDays,
    missedDays: Math.max(0, normalizedDaily.length - fullyCompletedDays),
    streak: runningStreak,
  };

  const habitRates = MISSION_FIELDS.map((field) => ({
    mission: field,
    completionRate: Math.round((missionTotals[field] / normalizedDaily.length) * 100),
  }));

  return {
    consistencyScore,
    completionSummary,
    habitRates,
    dailyBreakdown: normalizedDaily,
  };
};

const extractMetricTrend = (progressRows) => {
  const sorted = [...progressRows].sort((a, b) => (a.date > b.date ? 1 : -1));
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  if (!first || !last) return {};

  const toMap = (row) =>
    Object.fromEntries(
      (row.health_data || []).map((entry) => [entry.label, Number(entry.value) || 0]),
    );

  const firstMap = toMap(first);
  const lastMap = toMap(last);
  const labels = ["Testosterone", "Sperm Count", "Strength"];

  const trend = {};
  for (const label of labels) {
    if (Number.isFinite(firstMap[label]) && Number.isFinite(lastMap[label])) {
      trend[label] = {
        start: firstMap[label],
        end: lastMap[label],
        delta: Number((lastMap[label] - firstMap[label]).toFixed(2)),
      };
    }
  }
  return trend;
};

const parseJsonPayload = (content) => {
  const text = typeof content === "string" ? content : "";
  const cleanText = text.replace(/```json|```/gi, "").trim();
  const match = cleanText.match(/\{[\s\S]*\}/);
  const objectText = match ? match[0] : cleanText;
  return JSON.parse(objectText);
};

const getCachedReport = async (userId, window, personality) => {
  try {
    const { data, error } = await supabaseAdmin
      .from("ai_weekly_reports")
      .select("*")
      .eq("user_id", userId)
      .eq("week_start", window.startDate)
      .eq("week_end", window.endDate)
      .eq("report_day", window.reportDay)
      .eq("personality", personality)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      const msg = error.message || "";
      if (msg.includes("ai_weekly_reports") || error.code === "PGRST205") {
        return null;
      }
      throw error;
    }

    return data || null;
  } catch (error) {
    console.warn("AI coach cache lookup failed, continuing without cache:", error.message);
    return null;
  }
};

const saveCachedReport = async (userId, window, personality, payload) => {
  try {
    await supabaseAdmin.from("ai_weekly_reports").upsert(
      [
        {
          user_id: userId,
          week_start: window.startDate,
          week_end: window.endDate,
          report_day: window.reportDay,
          personality,
          week_range: payload.weekRange,
          consistency_score: payload.consistencyScore,
          completion_summary: payload.completionSummary,
          coach_message: payload.coachMessage,
          supplements: payload.supplements,
          generated_payload: payload.generatedPayload || null,
          model: payload.model || "llama-3.1-8b-instant",
        },
      ],
      {
        onConflict: "user_id,week_start,week_end,report_day,personality",
      },
    );
  } catch (error) {
    console.warn("AI coach cache save skipped:", error.message);
  }
};

export const generateOrGetWeeklyCoachReport = async (
  userId,
  { reportDay = "Sunday", personality = "balanced" } = {},
) => {
  if (!VALID_PERSONALITIES.includes(personality)) {
    throw new Error("Invalid coach personality");
  }

  const window = getReportWindow(reportDay);
  const cached = await getCachedReport(userId, window, personality);
  if (cached) {
    return {
      source: "cache",
      weekRange: cached.week_range,
      consistencyScore: cached.consistency_score,
      completionSummary: cached.completion_summary,
      coachMessage: cached.coach_message,
      supplements: cached.supplements || [],
      reportDay: window.reportDay,
      personality,
      model: cached.model || "cached",
    };
  }

  const { data: missions, error: missionsError } = await supabaseAdmin
    .from("daily_missions")
    .select("*")
    .eq("user_id", userId)
    .gte("date", window.startDate)
    .lte("date", window.endDate);
  if (missionsError) throw new Error(`Failed to load mission data: ${missionsError.message}`);

  const { data: progressRows, error: progressError } = await supabaseAdmin
    .from("progress")
    .select("date, health_data")
    .eq("user_id", userId)
    .gte("date", window.startDate)
    .lte("date", window.endDate);
  if (progressError) throw new Error(`Failed to load progress data: ${progressError.message}`);

  const { data: profileData } = await supabaseAdmin
    .from("user_profiles")
    .select("onboarding_data")
    .eq("id", userId)
    .maybeSingle();

  const missionSummary = calculateMissionSummary(
    missions || [],
    window.startDate,
    window.endDate,
  );
  const metricTrends = extractMetricTrend(progressRows || []);

  const groqKey = process.env.GROQ_API_KEY;
  if (!groqKey) throw new Error("Missing GROQ_API_KEY in backend environment");

  const promptPayload = {
    weekRange: window.weekRange,
    reportDay: window.reportDay,
    personality,
    consistencyScore: missionSummary.consistencyScore,
    completionSummary: missionSummary.completionSummary,
    habitRates: missionSummary.habitRates,
    dailyBreakdown: missionSummary.dailyBreakdown,
    metricTrends,
    onboardingData: profileData?.onboarding_data || null,
  };

  const prompt = `
You are an AI male health coach for a fertility/health app.
${PERSONA_PROMPTS[personality]}

Given this weekly data:
${JSON.stringify(promptPayload)}

Return strict JSON with this exact shape:
{
  "coachMessage": "string",
  "supplements": [
    {
      "name": "string",
      "reason": "string",
      "timing": "Morning|Evening|With meal",
      "note": "string (optional)"
    }
  ]
}

Rules:
- Keep coachMessage 2-4 concise sentences.
- Use real weak points from habitRates + dailyBreakdown.
- Suggest 2-3 supplements max, practical and safe.
- Avoid diagnosis/medical claims. Mention checking with a clinician in note when appropriate.
- Output JSON only, no markdown.
  `.trim();

  const aiResponse = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${groqKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "llama-3.1-8b-instant",
      temperature: 0.6,
      messages: [
        { role: "system", content: "You output valid JSON only." },
        { role: "user", content: prompt },
      ],
    }),
  });

  if (!aiResponse.ok) {
    const errorBody = await aiResponse.text();
    throw new Error(`Groq request failed (${aiResponse.status}): ${errorBody}`);
  }

  const json = await aiResponse.json();
  const content = json?.choices?.[0]?.message?.content;
  const parsed = parseJsonPayload(content);

  if (!parsed?.coachMessage || !Array.isArray(parsed?.supplements)) {
    throw new Error("Invalid AI payload received");
  }

  const normalizedSupplements = parsed.supplements
    .slice(0, 3)
    .map((entry) => ({
      name: String(entry.name || "").trim(),
      reason: String(entry.reason || "").trim(),
      timing: String(entry.timing || "").trim() || "With meal",
      note: entry.note ? String(entry.note).trim() : undefined,
    }))
    .filter((entry) => entry.name && entry.reason);

  const responsePayload = {
    source: "generated",
    weekRange: window.weekRange,
    consistencyScore: missionSummary.consistencyScore,
    completionSummary: missionSummary.completionSummary,
    coachMessage: String(parsed.coachMessage).trim(),
    supplements: normalizedSupplements,
    reportDay: window.reportDay,
    personality,
    model: "llama-3.1-8b-instant",
    generatedPayload: {
      habitRates: missionSummary.habitRates,
      metricTrends,
    },
  };

  await saveCachedReport(userId, window, personality, responsePayload);
  return responsePayload;
};
