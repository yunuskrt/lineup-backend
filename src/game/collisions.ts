import { resolveGuess, type SquadEntry } from '@/game/matcher.js';

export type GuessVerdict =
  | { kind: 'correct_new'; playerId: string }
  | { kind: 'already_found'; playerId: string }
  | { kind: 'not_in_xi' };

export type SquadCollision = { alias: string; playerIds: string[] };

function resolveCollision(
  candidateIds: readonly string[],
  squad: readonly SquadEntry[],
  foundIds: readonly string[],
): GuessVerdict {
  // A shared surname never reveals a player
  if (!candidateIds.every((id) => foundIds.includes(id))) {
    return { kind: 'not_in_xi' };
  }
  const first = squad.find((entry) => candidateIds.includes(entry.playerId));
  return first
    ? { kind: 'already_found', playerId: first.playerId }
    : { kind: 'not_in_xi' };
}

export function classifyGuess(
  guess: string,
  squad: readonly SquadEntry[],
  foundIds: readonly string[],
): GuessVerdict {
  const resolution = resolveGuess(guess, squad);
  switch (resolution.kind) {
    case 'miss':
      return { kind: 'not_in_xi' };
    case 'ambiguous':
      return resolveCollision(resolution.playerIds, squad, foundIds);
    case 'hit':
      return foundIds.includes(resolution.playerId)
        ? { kind: 'already_found', playerId: resolution.playerId }
        : { kind: 'correct_new', playerId: resolution.playerId };
  }
}

export function squadCollisions(
  squad: readonly SquadEntry[],
): SquadCollision[] {
  const owners = new Map<string, string[]>();
  for (const entry of squad) {
    for (const alias of new Set(entry.aliases)) {
      owners.set(alias, [...(owners.get(alias) ?? []), entry.playerId]);
    }
  }
  return [...owners]
    .filter(([, playerIds]) => playerIds.length > 1)
    .map(([alias, playerIds]) => ({ alias, playerIds }));
}
