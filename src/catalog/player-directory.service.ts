import { promisify } from 'node:util';
import { brotliCompress, constants, gzip } from 'node:zlib';
import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  type DirectoryEncoding,
  type DirectoryRow,
  directoryTag,
  toPlayerDirectory,
} from '@/catalog/player-directory.js';
import { ApiException, SERVER_ERROR_MESSAGE } from '@/common/api-exception.js';
import { ENV } from '@/config/config.module.js';
import type { Env } from '@/config/env.schema.js';
import { playerDirectorySchema } from '@/contract/catalog.js';
import { PlayerKeysService } from '@/matches/player-keys.service.js';
import { failureKind } from '@/prisma/save-errors.js';
import { PrismaService } from '@/prisma/prisma.service.js';

const gzipAsync = promisify(gzip);
const brotliAsync = promisify(brotliCompress);

const BROTLI_QUALITY = 11;

export type BuiltDirectory = {
  readonly version: string;
  readonly tag: string;
  readonly playerCount: number;
  readonly bodies: Readonly<Record<DirectoryEncoding, Buffer>>;
};

type Reader = Pick<PrismaService, '$queryRaw' | 'player'>;

type VersionRow = {
  players: string;
  player_hash: string;
  aliases: string;
  alias_hash: string;
};

// Only the rows and columns it reads (D2)
async function versionOf(db: Reader): Promise<string> {
  const [row] = await db.$queryRaw<VersionRow[]>`
    SELECT p.count::text AS players, p.hash::text AS player_hash,
           a.count::text AS aliases, a.hash::text AS alias_hash
    FROM (SELECT count(*) AS count,
                 coalesce(sum(hashtextextended(
                   (id, name, image_key)::text, 0)), 0) AS hash
          FROM players
          WHERE EXISTS (SELECT 1 FROM player_aliases
                        WHERE player_id = players.id)) p,
         (SELECT count(*) AS count,
                 coalesce(sum(hashtextextended(
                   (player_id, normalized)::text, 0)), 0) AS hash
          FROM player_aliases) a`;
  if (!row) throw new Error('Directory version query returned no row');
  return [row.players, row.player_hash, row.aliases, row.alias_hash].join(':');
}

function rowsOf(db: Reader): Promise<DirectoryRow[]> {
  return db.player.findMany({
    where: { aliases: { some: {} } },
    select: {
      id: true,
      name: true,
      imageKey: true,
      aliases: { select: { normalized: true } },
    },
  });
}

@Injectable()
export class PlayerDirectoryService {
  private readonly logger = new Logger('PlayerDirectory');
  private built: BuiltDirectory | null = null;
  private building: Promise<BuiltDirectory> | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly keys: PlayerKeysService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  // One aggregate query while nothing has changed
  async current(): Promise<BuiltDirectory> {
    const version = await versionOf(this.prisma);
    if (this.built?.version === version) return this.built;
    return this.rebuild();
  }

  // Concurrent callers share one build
  private rebuild(): Promise<BuiltDirectory> {
    this.building ??= this.build()
      .then((built) => (this.built = built))
      .finally(() => (this.building = null));
    return this.building;
  }

  private async build(): Promise<BuiltDirectory> {
    const startedAt = performance.now();
    try {
      // Rows and their version from one snapshot
      const { version, rows } = await this.prisma.$transaction(
        async (tx) => ({
          version: await versionOf(tx),
          rows: await rowsOf(tx),
        }),
        { isolationLevel: 'RepeatableRead' },
      );
      const built = await this.pack(version, rows);
      this.logBuilt(built, performance.now() - startedAt);
      return built;
    } catch (error) {
      if (error instanceof ApiException) throw error;
      this.logger.error(`Directory build failed (${failureKind(error)})`);
      throw new ApiException('server_error', SERVER_ERROR_MESSAGE);
    }
  }

  // Counts and sizes only, never a name
  private logBuilt(built: BuiltDirectory, ms: number): void {
    const { identity, gzip: gz, br } = built.bodies;
    this.logger.log(
      `Directory built: ${built.playerCount} players, ` +
        `${identity.length}/${gz.length}/${br.length} bytes ` +
        `raw/gzip/br, ${Math.round(ms)} ms`,
    );
  }

  private async pack(
    version: string,
    rows: DirectoryRow[],
  ): Promise<BuiltDirectory> {
    const directory = toPlayerDirectory(rows, this.env.ASSET_BASE_URL, (id) =>
      this.keys.keyOf(id),
    );
    const parsed = playerDirectorySchema.safeParse(directory);
    // Fail closed, once per build (D4)
    if (!parsed.success) {
      const issues = parsed.error.issues
        .map((issue) => `${issue.path.join('.')}:${issue.code}`)
        .join(', ');
      this.logger.error(`Directory is off-contract: ${issues}`);
      throw new ApiException('server_error', SERVER_ERROR_MESSAGE);
    }

    const identity = Buffer.from(
      JSON.stringify({ success: true, data: parsed.data }),
    );
    const [gzipped, brotli] = await Promise.all([
      gzipAsync(identity, { level: 9 }),
      brotliAsync(identity, {
        params: {
          [constants.BROTLI_PARAM_QUALITY]: BROTLI_QUALITY,
          [constants.BROTLI_PARAM_SIZE_HINT]: identity.length,
        },
      }),
    ]);
    return {
      version,
      tag: directoryTag({
        version,
        assetBase: this.env.ASSET_BASE_URL,
        keyFingerprint: this.keys.fingerprint,
      }),
      playerCount: parsed.data.players.length,
      bodies: { identity, gzip: gzipped, br: brotli },
    };
  }
}
