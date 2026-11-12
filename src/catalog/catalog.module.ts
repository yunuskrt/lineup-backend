import { Module } from '@nestjs/common';
import { ArchiveService } from '@/catalog/archive.service.js';
import { CatalogController } from '@/catalog/catalog.controller.js';
import { CatalogService } from '@/catalog/catalog.service.js';
import { PlayerDirectoryService } from '@/catalog/player-directory.service.js';
import { SYSTEM_CLOCK } from '@/common/clock.js';
import { MatchesModule } from '@/matches/matches.module.js';

@Module({
  imports: [MatchesModule],
  controllers: [CatalogController],
  providers: [
    ArchiveService,
    CatalogService,
    PlayerDirectoryService,
    SYSTEM_CLOCK,
  ],
})
export class CatalogModule {}
