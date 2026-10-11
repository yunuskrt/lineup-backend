# Phase B27 — Name Normalization

## Status

Complete

## Goals

- `src/game/normalize.ts`: `normalizeName(input: string): string`. Pure, no imports.
  1. Unicode **NFKD** (Open Questions 1). It decomposes accents, and also folds compatibility forms: `ﬁ` → `fi`, fullwidth `Ｍ` → `M`.
  2. Remove combining marks (U+0300–U+036F), so `İ` loses its dot **before** lowercasing.
  3. Remove format characters (`\p{Cf}`): zero-width space, zero-width joiner, soft hyphen, BOM. `Ibra­himović` stays one word.
  4. Lowercase.
  5. Map the letters NFKD doesn't decompose: `ı→i`, `ø→o`, `ł→l`, `đ→d`, `ð→d`, `æ→ae`, `œ→oe`, `ß→ss`, `þ→th`.
  6. Drop within-word apostrophes (`'`, `’`, `ʼ`, `` ` ``): `O'Shea` → `oshea`.
  7. Turn every other run of non-`[a-z0-9]` characters into one space, then trim (Open Questions 2).
  - The result is either `''` or matches `^[a-z0-9]+( [a-z0-9]+)*$`.
  - The function is idempotent: `normalizeName(normalizeName(x)) === normalizeName(x)`.
- `src/game/normalize.spec.ts`:
  - **Every case from the web mock's `normalize.test.ts`, copied by hand:**
    - `İbrahimović`, `Čech`, `Özil`, `Hernández`
    - `İSTANBUL`, `Şahin`, `Ilıcalı`, `Gökhan`, `Çalhanoğlu`
    - `Bjørn`, `Łukasz`, `Weiß`
    - `O'Shea`, `Hernández-Pérez`
    - whitespace collapse and trim
    - idempotence
    - input with no letters gives `''`
  - **Added here:**
    - Spanish and Portuguese: `Muñoz`, `João`, `Gonçalves`
    - Nordic and Icelandic: `Ødegaard`, `Guðjohnsen`, `Þórður`, `Ærø`
    - Slavic: `Đoković`, `Šimić`, `Žigić`
    - French and German: `Kanté`, `Müller`, `Gœthe`
    - a plain ASCII `I` lowercases to `i`
    - every apostrophe variant
    - initials and dots: `N. Kanté` → `n kante`, `Jr.` → `jr`
    - digits kept: `Bobby Charlton 2` → `bobby charlton 2`
    - NFKD folding: `ﬁ`, fullwidth letters, superscript `²` → `2`
    - format characters: ZWSP, ZWJ, soft hyphen and BOM leave no gap
    - input already decomposed (NFD) gives the same result as composed input
    - a non-Latin name (`Аршавин`, `Χαριστέας`) gives `''`
    - **property check:** over the whole case list, every output is idempotent and fits the shape regex
- **Seed:**
  - `scripts/seed/seed.ts` writes `normalized: normalizeName(alias)`, instead of copying the transcribed string.
  - `scripts/seed/seed-data.schema.ts`:
    - an alias must normalize to a non-empty string
    - two aliases of one player must not normalize alike. That's the (`player_id`, `normalized`) unique key, caught before any write.
    - Errors name a path, never a value, as in B09.
  - `scripts/seed/seed-data.spec.ts`: every transcribed alias already equals `normalizeName(alias)`. The mock stored them normalized, so a mismatch means the two pipelines disagree.
- **Migration** `prisma/migrations/<timestamp>_ascii_normalized_alias/` (Open Questions 3):
  - replaces `player_aliases_normalized_check` with `normalized ~ '^[a-z0-9]+( [a-z0-9]+)*$'`, which also implies lowercase
  - `test/schema/player-alias.e2e-spec.ts` gains cases: a non-ASCII `normalized`, an uppercase one and a double space are refused
- **Lint guard for `src/game/`:** an `.oxlintrc.json` override for `src/game/**` that forbids importing `@nestjs/*`, `@prisma/*`, `@/generated/*` and `@/prisma/*`, so CLAUDE.md's "pure, imports nothing from NestJS or Prisma" is enforced, not only written down.

## Open Questions

All three settled at `/feature load`, each as recommended: NFKD, ASCII-only output, and the tightened CHECK in a new migration.

1. **NFD or NFKD?** The web mock uses NFD. **Recommended: NFKD.** It does everything NFD does, and also folds compatibility characters a phone keyboard or a paste can produce: ligatures, fullwidth letters, superscripts. For the 345 seeded ASCII aliases the result is identical. The web mock isn't the contract; normalization runs only on the server.
2. **Output alphabet: ASCII only, or keep any Unicode letter?** **Recommended: ASCII only (`[a-z0-9]`), as the mock does.**
   - Every target league and tournament writes names in Latin script.
   - A Cyrillic or Greek spelling becomes a Latin alias in the alias table (B17), not a second script in the matcher.
   - An all-non-Latin guess normalizes to `''`, and B28 treats it as `not_in_xi` without a lookup.
   - The alternative, keeping `\p{L}`, makes `pg_trgm` thresholds (B28) script-dependent.
3. **Tighten the database CHECK to the ASCII shape?** B06 left it loose on purpose until this phase fixed the alphabet. **Recommended: yes, in a new migration.** A future loader (the scraper's load step) that skips the normalizer then fails at insert, not at match time. Choose no only if Open Questions 2 keeps Unicode letters.

## Out of Scope

- Using it to match a guess: B28 (exact and `pg_trgm` fuzzy), and B29 (surname collisions).
- Transliterating non-Latin scripts. Latin aliases come from ingestion (B17).
- Normalizing club aliases: no phase reads `club_aliases` for matching yet.
- A SQL copy of the normalizer. There is exactly one implementation; the database only checks its output shape.

## Notes

- Scope: one pure function and its spec, a seed change, one migration, one lint override.
- Depends on: B06 (the `normalized` column and its CHECK), B09 (the seed and its transcribed aliases).
- **`src/game/` is pure** (CLAUDE.md, Hard Constraint 7): no NestJS, no Prisma, no I/O. `normalize.ts` needs no imports at all.
- **B06 and B09 both pointed here:**
  - B06: "When B27 lands, it adds a check that every stored `normalized` equals `normalizeName(alias)`."
  - B09: "B27 must check that its own pipeline maps every seeded alias to itself, and re-seed if not."

  The seed spec case and the `npm run db:seed` rerun below are that check.
- **Ported, not imported.** The web's `normalize.ts` is the reference, copied by hand. No path reaches into `lineup-web`.
- **`scripts/` may import `src/game/`.** The seed is the first script to depend on the rules engine; the reverse is still forbidden.
- **Never log a name.** The seed's errors keep naming paths only.
- Constraints:
  - no `any`; `@/` imports; comments single-line, at most 50 characters
  - `prisma migrate dev --create-only`, edited by hand, then applied; never edit an applied migration
- Verification:
  - `npm test`, `npm run test:e2e`, `npm run build`, `npm run lint`
  - `npm run db:seed` on the dev branch after the change prints `0 changed` for aliases. Every stored `normalized` already equals the pipeline's output, so nothing is rewritten.
  - The lint guard is checked once by hand: a throwaway `import '@nestjs/common'` in `src/game/` fails `npm run lint`, and is then removed.

**Deviations recorded during implementation**

- **Combining marks are stripped with `\p{M}`,** not only U+0300–U+036F. It's a superset with identical output for Latin names, and a mark from another block (e.g. U+20D7) no longer splits a word. A unit case pins it.
- **The seed schema checks raw aliases, not normalized ones.** Its old "lowercase" and whitespace-shape rules belonged to the stored form, which the seed now derives. They became "an alias must normalize to a name" and "aliases must not normalize alike". The seed spec's cases moved with them:
  - "an uppercase alias" became "an alias with no letters"
  - added: "two aliases that normalize alike" (an uppercase copy)
  - added: a raw `  Ünal-Ödemiş ` is accepted
  - the rejected list is now `''`, blank, dashes only, and a Cyrillic name
- **The lint guard needs `**` patterns.** A single `*` matches one path segment, so `@/generated/*` let `@/generated/prisma/client.js` through. Checked with a throwaway file importing `@nestjs/common`, a type from `@/generated/prisma/client.js`, `@/prisma/prisma.service.js` and `@prisma/adapter-pg`: all four were refused. The file was removed.
- **Migration `20261011213718_ascii_normalized_alias`** drops and re-adds `player_aliases_normalized_check` as `^[a-z0-9]+( [a-z0-9]+)*$`. Applied to the dev branch; checked with Neon that the new definition is live and that 0 stored rows violate it. The e2e suite gained 4 refusals: a diacritic, a non-Latin letter, an apostrophe and a hyphen. Uppercase and double-space cases were already there from B06.
- **The B06/B09 check holds:** all 345 transcribed aliases equal `normalizeName(alias)`, and `npm run db:seed` on the dev branch printed `0 changed` for every table.
- **Tests:** 495 unit and 305 e2e, all green. New: 56 in `normalize.spec.ts`, 3 more in `seed-data.spec.ts`, and 4 e2e refusals.
- **`/feature test`:** no new tests needed. **Coverage from unit tests:**
  - `normalize.ts`: 100% of statements, branches, functions and lines.
  - `seed-data.schema.ts`: 100% of lines, 93% of branches. The uncovered branches (lines 166–167 and 187: an unknown away club, a missing competition kind) are B09's match checks, untouched here. The two alias rules B27 changed are fully covered.
  - `seed.ts` writes to the database, so its coverage comes from the seed e2e suite (B09), which passes. The B27 change there is one line, `normalized: normalizeName(alias)`, and the `0 changed` rerun on the dev branch checks it against real rows.
- **Review fixes:**
  - The lint message said "no NestJS, Prisma or I/O", but the rule only blocks NestJS and Prisma imports. It now reads "no NestJS or Prisma imports", so it claims only what it enforces.
  - Two new comments were 51 characters and were shortened. Two older ones over the limit (`seed.ts:249` and `player-alias.e2e-spec.ts:60`) predate this phase and were left alone.

## History
