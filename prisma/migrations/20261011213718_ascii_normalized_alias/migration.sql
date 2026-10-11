-- Hand-written: B27 fixed the alphabet at [a-z0-9].
-- The output shape of normalizeName (src/game/normalize.ts);
-- SQL still never re-implements the normalizer itself.
ALTER TABLE "player_aliases" DROP CONSTRAINT "player_aliases_normalized_check";

ALTER TABLE "player_aliases" ADD CONSTRAINT "player_aliases_normalized_check"
    CHECK ("normalized" ~ '^[a-z0-9]+( [a-z0-9]+)*$');
