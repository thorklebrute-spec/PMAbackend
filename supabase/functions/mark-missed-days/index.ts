import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

serve(async (req) => {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);

  const today = new Date().toISOString().split("T")[0];

  // Penalty values
  const RANK_PENALTY = 10;
  const PROGRESS_PENALTY = {
    testosterone: 2, // ng/dL
    spermCount: 0.5, // million/mL
    strength: 0.5    // kg
  };

  // 1. Get all users
  const { data: users, error: userError } = await supabase
    .from("user_profiles")
    .select("id");

  if (userError) {
    return new Response(JSON.stringify({ error: userError.message }), { status: 500 });
  }

  let penalized = 0;
  let skipped = 0;

  for (const user of users) {
    // 2. Get today's daily_missions
    const { data: mission, error: missionError } = await supabase
      .from("daily_missions")
      .select("*")
      .eq("user_id", user.id)
      .eq("date", today)
      .single();

    let missed = false;
    let incomplete = false;

    if (missionError && missionError.code !== "PGRST116") {
      // Unexpected error
      continue;
    }

    if (!mission) {
      missed = true;
    } else {
      // Check if all core missions are completed
      const required = [
        "sleep_completed",
        "exercise_completed",
        "sunlight_completed",
        "diet_completed",
        "alcohol_avoided",
        "cold_exposure_completed",
        "no_porn_masturbation"
      ];
      incomplete = !required.every((key) => mission[key]);
    }

    if (missed || incomplete) {
      // 3. Deduct points from rank
      const { data: rank, error: rankError } = await supabase
        .from("user_ranks")
        .select("total_points")
        .eq("user_id", user.id)
        .single();

      if (rank && rank.total_points > 0) {
        const newPoints = Math.max(0, rank.total_points - RANK_PENALTY);
        await supabase
          .from("user_ranks")
          .update({ total_points: newPoints })
          .eq("user_id", user.id);
      }

      // 4. Insert a missed record if none exists
      if (missed) {
        await supabase
          .from("daily_missions")
          .insert({
            user_id: user.id,
            date: today,
            sleep_completed: false,
            exercise_completed: false,
            sunlight_completed: false,
            diet_completed: false,
            alcohol_avoided: false,
            cold_exposure_completed: false,
            no_porn_masturbation: false,
          });
      }

      // 5. Penalize progress metrics (decrease today's progress or create a new one)
      // Get today's progress
      const { data: progress, error: progressError } = await supabase
        .from("progress")
        .select("*")
        .eq("user_id", user.id)
        .eq("date", today)
        .single();

      if (progress && progress.health_data) {
        // Decrease metrics
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
        // No progress for today: create a new one with penalty (use yesterday's as base if available)
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
          { label: "Strength", value: "70", icon: "barbell-outline", color: "#2c3e50" }
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

        await supabase
          .from("progress")
          .insert({
            user_id: user.id,
            date: today,
            health_data: penalizedHealthData,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          });
      }

      penalized++;
    } else {
      skipped++;
    }
  }

  return new Response(
    JSON.stringify({ penalized, skipped, message: "Missed/incomplete days processed" }),
    { status: 200 }
  );
});