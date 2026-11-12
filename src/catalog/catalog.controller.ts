import {
  applyDecorators,
  Controller,
  Get,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { ApiQuery, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { ProGated } from '@/auth/pro-gated.decorator.js';
import { Public } from '@/auth/public.decorator.js';
import { DocumentsSession } from '@/auth/session-docs.decorator.js';
import { ARCHIVE_MESSAGES, ArchiveService } from '@/catalog/archive.service.js';
import { CatalogService } from '@/catalog/catalog.service.js';
import {
  DIRECTORY_HEADERS,
  sendDirectory,
} from '@/catalog/directory-response.js';
import { PlayerDirectoryService } from '@/catalog/player-directory.service.js';
import {
  ContractResponse,
  DirectResponse,
} from '@/common/contract-response.js';
import { RateLimit } from '@/common/rate-limits.js';
import { ZodValidationPipe } from '@/common/zod-validation.pipe.js';
import {
  type ArchivePage,
  archivePageSchema,
  type ArchiveQuery,
  archiveQuerySchema,
  type CatalogOverview,
  catalogOverviewSchema,
  type FilterOptions,
  filterOptionsSchema,
  playerDirectorySchema,
} from '@/contract/catalog.js';
import {
  DEFAULT_ARCHIVE_LIMIT,
  FIRST_SEASON_START,
  LAST_SEASON_START,
  MAX_ARCHIVE_LIMIT,
  MAX_GUESS_LENGTH,
} from '@/contract/constants.js';

const SEASON_START = {
  type: 'integer',
  minimum: FIRST_SEASON_START,
  maximum: LAST_SEASON_START,
} as const;

// Docs only: archiveQuerySchema does the checking
const ArchiveQueryDocs = () =>
  applyDecorators(
    ApiQuery({
      name: 'q',
      required: false,
      schema: { type: 'string', minLength: 1, maxLength: MAX_GUESS_LENGTH },
    }),
    ApiQuery({ name: 'competitionId', required: false, type: String }),
    ApiQuery({ name: 'clubId', required: false, type: String }),
    ApiQuery({ name: 'from', required: false, schema: SEASON_START }),
    ApiQuery({ name: 'to', required: false, schema: SEASON_START }),
    ApiQuery({ name: 'cursor', required: false, type: String }),
    ApiQuery({
      name: 'limit',
      required: false,
      schema: {
        type: 'integer',
        minimum: 1,
        maximum: MAX_ARCHIVE_LIMIT,
        default: DEFAULT_ARCHIVE_LIMIT,
      },
    }),
  );

@ApiTags('catalog')
@Controller('catalog')
export class CatalogController {
  constructor(
    private readonly catalog: CatalogService,
    private readonly directory: PlayerDirectoryService,
    private readonly archive: ArchiveService,
  ) {}

  // Public: /play renders before any session
  @Public()
  @Get('filter-options')
  @RateLimit('catalog')
  @ContractResponse(filterOptionsSchema)
  filterOptions(): Promise<FilterOptions> {
    return this.catalog.filterOptions();
  }

  // Public: the landing page has no session yet
  @Public()
  @Get('overview')
  @RateLimit('catalog')
  @ContractResponse(catalogOverviewSchema)
  overview(): Promise<CatalogOverview> {
    return this.catalog.overview();
  }

  // Pro while the split is on, else public
  @ProGated(ARCHIVE_MESSAGES.proRequired)
  @Get('matches')
  @RateLimit('catalog')
  @ArchiveQueryDocs()
  @ContractResponse(archivePageSchema)
  matches(
    @Query(new ZodValidationPipe(archiveQuerySchema)) query: ArchiveQuery,
  ): Promise<ArchivePage> {
    return this.archive.page(query);
  }

  // Any session, guests too; never scoped (HC 2)
  @Get('players')
  @DocumentsSession()
  @RateLimit('catalog')
  @DirectResponse(playerDirectorySchema, { headers: DIRECTORY_HEADERS })
  async players(@Req() req: Request, @Res() res: Response): Promise<void> {
    sendDirectory(req, res, await this.directory.current());
  }
}
