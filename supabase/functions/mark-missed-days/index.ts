// =============================================================================
// mark-missed-days — Supabase Edge Function (Deno runtime)
// =============================================================================
// Triggered daily at midnight UTC by pg_cron (see sql/migration_add_cron_job.sql).
//
// For each user in user_profiles:
//   1. Check today's daily_missions row
//   2. If missing or incomplete (any of 7 missions false) → penalize:
//      - Deduct RANK_PENALTY from user_ranks.total_points and streak_days
//      - Insert empty mission row if none exists for today
//      - Decrease progress health_data (Testosterone, Sperm Count, Strength)
//
// Env (auto-injected by Supabase): SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// Deploy: supabase functions deploy mark-missed-days
// =============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import { MISSION_FIELDS } from "../../../src/constants/missions.js";

/** HTTP handler — invoked by cron POST to /functions/v1/mark-missed-days */
Deno.serve(async (req) => {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);

  const today = new Date().toISOString().split("T")[0];

  // Penalty values applied when missions are missed or incomplete
  const RANK_PENALTY = 400;
  const PROGRESS_PENALTY = {
    testosterone: 2, // ng/dL
    spermCount: 0.5, // million/mL
    strength: 0.5, // kg
  };

  // ---------------------------------------------------------------------------
  // 1. Load all users from user_profiles
  // ---------------------------------------------------------------------------
  const { data: users, error: userError } = await supabase
    .from("user_profiles")
    .select("id");

  if (userError) {
    return new Response(JSON.stringify({ error: userError.message }), { status: 500 });
  }

  let penalized = 0;
  let skipped = 0;

  for (const user of users) {
    // -------------------------------------------------------------------------
    // 2. Fetch today's daily_missions for this user
    // -------------------------------------------------------------------------
    const { data: mission, error: missionError } = await supabase
      .from("daily_missions")
      .select("*")
      .eq("user_id", user.id)
      .eq("date", today)
      .single();

    let missed = false;
    let incomplete = false;

    if (missionError && missionError.code !== "PGRST116") {
      // Unexpected error (PGRST116 = no rows — treat as missed)
      continue;
    }

    if (!mission) {
      missed = true;
    } else {
      incomplete = !MISSION_FIELDS.every((key) => mission[key]);
    }

    if (missed || incomplete) {
      // -----------------------------------------------------------------------
      // 3. Deduct rank points and reduce streak
      // -----------------------------------------------------------------------
      const { data: rank, error: rankError } = await supabase
        .from("user_ranks")
        .select("total_points, streak_days")
        .eq("user_id", user.id)
        .single();

      if (rank) {
        const newPoints = Math.max(0, rank.total_points - RANK_PENALTY);
        const newStreak = Math.max(0, (rank.streak_days || 0) - 1);
        await supabase
          .from("user_ranks")
          .update({
            total_points: newPoints,
            streak_days: newStreak,
          })
          .eq("user_id", user.id);
      }

      // -----------------------------------------------------------------------
      // 4. Insert empty mission record if user had no row for today
      // -----------------------------------------------------------------------
      if (missed) {
        await supabase.from("daily_missions").insert({
          user_id: user.id,
          date: today,
          ...Object.fromEntries(MISSION_FIELDS.map((field) => [field, false])),
        });
      }

      // -----------------------------------------------------------------------
      // 5. Penalize progress metrics (decrease today or create from yesterday)
      // -----------------------------------------------------------------------
      const { data: progress, error: progressError } = await supabase
        .from("progress")
        .select("*")
        .eq("user_id", user.id)
        .eq("date", today)
        .single();

      if (progress && progress.health_data) {
        const newHealthData = progress.health_data.map((item: any) => {
          if (item.label === "Testosterone") {
            return { ...item, value: (parseFloat(item.value) - PROGRESS_PENALTY.testosterone).toString() };
          }
          if (item.label === "Sperm Count") {
            return { ...item, value: (parseFloat(item.value) - PROGRESS_PENALTY.spermCount).toString() };
          }
          if (item.label === "Strength") {
            return { ...item, value: (parseFloat(item.value) - PROGRESS_PENALTY.strength).toString() };
          }
          return item;
        });
        await supabase
          .from("progress")
          .update({ health_data: newHealthData })
          .eq("id", progress.id);
      } else {
        const { data: prev, error: prevError } = await supabase
          .from("progress")
          .select("*")
          .eq("user_id", user.id)
          .order("date", { ascending: false })
          .limit(1)
          .single();

        let base = prev && prev.health_data ? prev.health_data : [
          { label: "Testosterone", value: "600", icon: "flash", color: "#c0392b" },
          { label: "Sperm Count", value: "50", icon: "flask", color: "#2980b9" },
          { label: "Strength", value: "70", icon: "barbell-outline", color: "#2c3e50" },
        ];

        const penalizedHealthData = base.map((item: any) => {
          if (item.label === "Testosterone") {
            return { ...item, value: (parseFloat(item.value) - PROGRESS_PENALTY.testosterone).toString() };
          }
          if (item.label === "Sperm Count") {
            return { ...item, value: (parseFloat(item.value) - PROGRESS_PENALTY.spermCount).toString() };
          }
          if (item.label === "Strength") {
            return { ...item, value: (parseFloat(item.value) - PROGRESS_PENALTY.strength).toString() };
          }
          return item;
        });

        await supabase.from("progress").insert({
          user_id: user.id,
          date: today,
          health_data: penalizedHealthData,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });
      }

      penalized++;
    } else {
      skipped++;
    }
  }

  return new Response(
    JSON.stringify({ penalized, skipped, message: "Missed/incomplete days processed" }),
    { status: 200 },
  );
});
