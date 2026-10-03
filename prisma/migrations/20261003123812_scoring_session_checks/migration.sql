-- Hand-written: CHECKs added after B08's review

-- The server picks a duel's side before the session exists
ALTER TABLE "game_sessions" ADD CONSTRAINT "game_sessions_side_check"
    CHECK ("mode" = 'solo' OR "side" IS NOT NULL);

-- Best single-game streak; one XI has 11 starters
ALTER TABLE "user_stats" ADD CONSTRAINT "user_stats_best_streak_check"
    CHECK ("best_streak" <= 11);
