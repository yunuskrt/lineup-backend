import { Controller, Get, Req, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { Public } from '@/auth/public.decorator.js';
import { DocumentsSession } from '@/auth/session-docs.decorator.js';
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
import {
  type CatalogOverview,
  catalogOverviewSchema,
  type FilterOptions,
  filterOptionsSchema,
  playerDirectorySchema,
} from '@/contract/catalog.js';

@ApiTags('catalog')
@Controller('catalog')
export class CatalogController {
  constructor(
    private readonly catalog: CatalogService,
    private readonly directory: PlayerDirectoryService,
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

  // Any session, guests too; never scoped (HC 2)
  @Get('players')
  @DocumentsSession()
  @RateLimit('catalog')
  @DirectResponse(playerDirectorySchema, { headers: DIRECTORY_HEADERS })
  async players(@Req() req: Request, @Res() res: Response): Promise<void> {
    sendDirectory(req, res, await this.directory.current());
  }
}
