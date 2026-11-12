import type { ArchivePage, ArchiveQuery } from '@/contract/catalog.js';
import type { MatchIdentity } from '@/contract/match.js';
import { normalizeName } from '@/game/normalize.js';

// One pool match, with what the filters read
export type ArchiveEntry = {
  identity: MatchIdentity;
  competitionId: string;
  clubIds: readonly [string, string];
  seasonStart: number;
  words: readonly string[];
};

export type ArchiveSource = {
  identity: MatchIdentity;
  seasonStart: number;
  // Each club's aliases, by club id
  aliases: ReadonlyMap<string, readonly string[]>;
};

type Cursor = { date: string; id: string };

const SPLIT_SEASON = /^\d{4}-\d{2}$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function wordsOf(text: string | null): string[] {
  return text ? normalizeName(text).split(' ').filter(Boolean) : [];
}

// Every search word; R15: not the nickname
export function archiveWords(source: ArchiveSource): string[] {
  const { identity, seasonStart, aliases } = source;
  const texts = [
    identity.competition.name,
    identity.season,
    String(seasonStart),
    // 2004-05 is also 2005
    SPLIT_SEASON.test(identity.season) ? String(seasonStart + 1) : null,
    identity.date.slice(0, 4),
  ];
  for (const club of [identity.home, identity.away]) {
    texts.push(club.name, club.shortName, ...(aliases.get(club.id) ?? []));
  }
  return [...new Set(texts.flatMap(wordsOf))];
}

export function toArchiveEntry(source: ArchiveSource): ArchiveEntry {
  const { identity } = source;
  return {
    identity,
    competitionId: identity.competition.id,
    clubIds: [identity.home.id, identity.away.id],
    seasonStart: source.seasonStart,
    words: archiveWords(source),
  };
}

// Newest first, then by id; never score (HC 20)
export function newestFirst(a: ArchiveEntry, b: ArchiveEntry): number {
  const { date: da, id: ia } = a.identity;
  const { date: db, id: ib } = b.identity;
  if (da !== db) return da < db ? 1 : -1;
  if (ia === ib) return 0;
  return ia < ib ? 1 : -1;
}

export function encodeCursor({ identity }: ArchiveEntry): string {
  const raw = `${identity.date}|${identity.id}`;
  return Buffer.from(raw).toString('base64url');
}

export function decodeCursor(text: string): Cursor | null {
  const raw = Buffer.from(text, 'base64url').toString();
  const bar = raw.indexOf('|');
  const date = raw.slice(0, bar);
  const id = raw.slice(bar + 1);
  if (bar < 0 || !ISO_DATE.test(date) || id.length === 0) return null;
  return { date, id };
}

// Each query word starts one of the match's words
export function matchesText(entry: ArchiveEntry, wanted: readonly string[]) {
  return wanted.every((word) =>
    entry.words.some((own) => own.startsWith(word)),
  );
}

function matchesFilters(
  entry: ArchiveEntry,
  query: ArchiveQuery,
  wanted: readonly string[],
): boolean {
  const { competitionId, clubId, from, to } = query;
  if (competitionId && entry.competitionId !== competitionId) return false;
  if (clubId && !entry.clubIds.includes(clubId)) return false;
  if (from !== undefined && entry.seasonStart < from) return false;
  if (to !== undefined && entry.seasonStart > to) return false;
  return matchesText(entry, wanted);
}

const isAfter = (entry: ArchiveEntry, cursor: Cursor) => {
  const { date, id } = entry.identity;
  return date < cursor.date || (date === cursor.date && id < cursor.id);
};

// entries newest first; null for a bad cursor
export function archivePage(
  entries: readonly ArchiveEntry[],
  query: ArchiveQuery,
): ArchivePage | null {
  const cursor = query.cursor ? decodeCursor(query.cursor) : undefined;
  if (cursor === null) return null;

  // Normalized once, not once per match
  const wanted = wordsOf(query.q ?? null);
  const matched = entries.filter((entry) =>
    matchesFilters(entry, query, wanted),
  );
  const start = cursor
    ? matched.findIndex((entry) => isAfter(entry, cursor))
    : 0;
  const rest = start < 0 ? [] : matched.slice(start);
  const page = rest.slice(0, query.limit);
  const last = page.at(-1);
  return {
    entries: page.map((entry) => entry.identity),
    nextCursor: last && rest.length > page.length ? encodeCursor(last) : null,
    total: matched.length,
  };
}
