import { createHash } from 'node:crypto';
import type { DirectoryPlayer, PlayerDirectory } from '@/contract/catalog.js';
import { assetUrl } from '@/matches/asset-url.js';

export type DirectoryRow = {
  id: string;
  name: string;
  imageKey: string | null;
  aliases: { normalized: string }[];
};

export type DirectoryEncoding = 'br' | 'gzip' | 'identity';

// Bump when the payload's shape or rules change
const FORMAT = 'player-directory:1';

const byKey = (a: DirectoryPlayer, b: DirectoryPlayer) =>
  a.key < b.key ? -1 : a.key > b.key ? 1 : 0;

// The whole table, never scoped (HC 2)
export function toPlayerDirectory(
  rows: readonly DirectoryRow[],
  assetBase: string | undefined,
  keyOf: (playerId: string) => string,
): PlayerDirectory {
  const players = rows
    .filter((row) => row.aliases.length > 0)
    .map((row): DirectoryPlayer => ({
      key: keyOf(row.id),
      name: row.name,
      imageUrl: assetUrl(assetBase, row.imageKey),
      terms: [...new Set(row.aliases.map((a) => a.normalized))].sort(),
    }));
  return { players: players.sort(byKey) };
}

export type TagParts = {
  version: string;
  assetBase: string | undefined;
  keyFingerprint: string;
};

// Strong: one tag per exact body
export function directoryTag(parts: TagParts): string {
  const digest = createHash('sha256')
    .update(
      [FORMAT, parts.version, parts.assetBase ?? '', parts.keyFingerprint].join(
        '\n',
      ),
    )
    .digest('base64url')
    .slice(0, 32);
  return `"${digest}"`;
}

// Weak comparison, as If-None-Match requires
export function matchesTag(header: string | undefined, tag: string): boolean {
  if (!header) return false;
  const opaque = (value: string) => value.trim().replace(/^W\//, '');
  return header
    .split(',')
    .some((candidate) => candidate.trim() === '*' || opaque(candidate) === tag);
}

function qualities(header: string): Map<string, number> {
  const map = new Map<string, number>();
  for (const part of header.split(',')) {
    const [token, ...params] = part.trim().toLowerCase().split(';');
    if (!token) continue;
    const q = params
      .map((param) => param.trim().match(/^q=([0-9.]+)$/)?.[1])
      .find((value) => value !== undefined);
    map.set(token, q === undefined ? 1 : Number(q));
  }
  return map;
}

// Brotli first, then gzip, else uncompressed
export function pickEncoding(header: string | undefined): DirectoryEncoding {
  const q = qualities(header ?? '');
  const allows = (token: string) => (q.get(token) ?? q.get('*') ?? 0) > 0;
  if (allows('br')) return 'br';
  if (allows('gzip')) return 'gzip';
  return 'identity';
}
