import { type Showcase, showcaseSchema } from '@/contract/catalog.js';
import type { Side } from '@/contract/common.js';
import { SQUAD_SIZE } from '@/contract/constants.js';
import { positionForSlot } from '@/game/formation.js';
import type { Prisma } from '@/generated/prisma/client.js';
import { assetUrl } from '@/matches/asset-url.js';
import {
  MATCH_IDENTITY_SELECT,
  toMatchIdentity,
  toMatchInPlay,
} from '@/matches/match-refs.js';
import type { ShowcaseSpec } from '@/matches/showcase.js';

// Both XIs: the demo's miss is from the other one
export const SHOWCASE_SELECT = {
  ...MATCH_IDENTITY_SELECT,
  teams: {
    select: {
      ...MATCH_IDENTITY_SELECT.teams.select,
      formation: true,
      lineups: {
        select: {
          slot: true,
          position: true,
          player: {
            select: {
              id: true,
              slug: true,
              name: true,
              imageKey: true,
              _count: { select: { aliases: true } },
            },
          },
        },
        orderBy: { slot: 'asc' },
      },
    },
  },
} satisfies Prisma.MatchSelect;

export type ShowcaseRow = Prisma.MatchGetPayload<{
  select: typeof SHOWCASE_SELECT;
}>;
type LineupRow = ShowcaseRow['teams'][number]['lineups'][number];

// A reason names a slug or a check, never a name
export type ShowcaseView = { showcase: Showcase } | { reason: string };

const otherSide = (side: Side): Side => (side === 'home' ? 'away' : 'home');

// The squad loader's checks, as reasons
function squadFault(
  side: Side,
  formation: string,
  lineups: readonly LineupRow[],
): string | null {
  if (lineups.length !== SQUAD_SIZE) {
    return `${side} XI has ${lineups.length} starters`;
  }
  for (const { slot, position, player } of lineups) {
    if (positionForSlot(formation, slot) !== position) {
      return `${side} slot ${slot} breaks ${formation}`;
    }
    if (player._count.aliases === 0) return `${side} slot ${slot} has no alias`;
  }
  return null;
}

function demoFault(
  spec: ShowcaseSpec,
  named: readonly LineupRow[],
  other: readonly LineupRow[],
): string | null {
  const repeated = spec.reveals.find((s, i) => spec.reveals.indexOf(s) !== i);
  if (repeated) return `reveal ${repeated} repeats`;
  const inNamed = new Set(named.map(({ player }) => player.slug));
  const missing = spec.reveals.find((slug) => !inNamed.has(slug));
  if (missing) return `reveal ${missing} is not in the ${spec.side} XI`;
  // The wrong guess must really be wrong
  if (!other.some(({ player }) => player.slug === spec.miss)) {
    return `miss ${spec.miss} is not in the ${otherSide(spec.side)} XI`;
  }
  return null;
}

export function toShowcase(
  spec: ShowcaseSpec,
  row: ShowcaseRow | null,
  assetBase: string | undefined,
  keyOf: (playerId: string) => string,
): ShowcaseView {
  if (!row) return { reason: `match ${spec.matchSlug} is not loaded` };
  const named = row.teams.find((team) => team.side === spec.side);
  const other = row.teams.find((team) => team.side === otherSide(spec.side));
  if (!named?.formation || !other) {
    return { reason: `${spec.side} side has no formation or no opponent` };
  }
  const fault =
    squadFault(spec.side, named.formation, named.lineups) ??
    demoFault(spec, named.lineups, other.lineups);
  if (fault) return { reason: fault };

  const slotOf = new Map(named.lineups.map((l) => [l.player.slug, l.slot]));
  const miss = other.lineups.find(({ player }) => player.slug === spec.miss);
  const parsed = showcaseSchema.safeParse({
    match: toMatchInPlay(
      toMatchIdentity(row, assetBase),
      spec.side,
      named.formation,
    ),
    players: named.lineups.map(({ slot, position, player }) => ({
      id: player.id,
      name: player.name,
      slot,
      position,
      imageUrl: assetUrl(assetBase, player.imageKey),
      directoryKey: keyOf(player.id),
    })),
    demo: {
      reveals: spec.reveals.flatMap((slug) => slotOf.get(slug) ?? []),
      miss: miss
        ? {
            name: miss.player.name,
            imageUrl: assetUrl(assetBase, miss.player.imageKey),
            directoryKey: keyOf(miss.player.id),
          }
        : null,
    },
  });
  // Never let one bad row fail the whole overview
  return parsed.success
    ? { showcase: parsed.data }
    : { reason: 'it fails the Showcase schema' };
}
