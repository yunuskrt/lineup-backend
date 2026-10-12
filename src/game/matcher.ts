import { normalizeName } from '@/game/normalize.js';

// Keeps "ronaldo" off "ronaldinho" (0.70 apart)
export const FUZZY_THRESHOLD = 0.82;

// Aliases are stored normalized (B27 CHECK)
export type SquadEntry = {
  playerId: string;
  aliases: readonly string[];
};

export type MatchResolution =
  | { kind: 'hit'; playerId: string }
  | { kind: 'ambiguous'; playerIds: string[] }
  | { kind: 'miss' };

// Restricted Damerau-Levenshtein: a swap costs 1
function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  const rows: number[][] = [Array.from({ length: b.length + 1 }, (_, j) => j)];
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let value = Math.min(
        current[j - 1] + 1,
        rows[i - 1][j] + 1,
        rows[i - 1][j - 1] + cost,
      );
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        value = Math.min(value, rows[i - 2][j - 2] + 1);
      }
      current[j] = value;
    }
    rows.push(current);
  }
  return rows[a.length][b.length];
}

export function similarity(a: string, b: string): number {
  const longest = Math.max(a.length, b.length);
  if (longest === 0) return 1;
  return 1 - editDistance(a, b) / longest;
}

function exactMatches(
  normalized: string,
  squad: readonly SquadEntry[],
): string[] {
  return squad
    .filter((entry) => entry.aliases.includes(normalized))
    .map((entry) => entry.playerId);
}

// Ties kept so a typo can't dodge a collision
function bestFuzzyMatches(
  normalized: string,
  squad: readonly SquadEntry[],
): string[] {
  let best: string[] = [];
  let bestScore = FUZZY_THRESHOLD;
  for (const entry of squad) {
    for (const alias of entry.aliases) {
      const score = similarity(normalized, alias);
      if (score > bestScore) {
        bestScore = score;
        best = [entry.playerId];
      } else if (
        // Only ties above the threshold: it's strict
        best.length > 0 &&
        score === bestScore &&
        !best.includes(entry.playerId)
      ) {
        best.push(entry.playerId);
      }
    }
  }
  return best;
}

function toResolution(playerIds: string[]): MatchResolution {
  if (playerIds.length === 0) return { kind: 'miss' };
  if (playerIds.length === 1) return { kind: 'hit', playerId: playerIds[0] };
  return { kind: 'ambiguous', playerIds };
}

export function resolveGuess(
  guess: string,
  squad: readonly SquadEntry[],
): MatchResolution {
  const normalized = normalizeName(guess);
  if (normalized === '') return { kind: 'miss' };

  const exact = exactMatches(normalized, squad);
  if (exact.length > 0) return toResolution(exact);
  return toResolution(bestFuzzyMatches(normalized, squad));
}
