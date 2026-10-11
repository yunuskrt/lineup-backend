import { Module } from '@nestjs/common';
import { CatalogController } from '@/catalog/catalog.controller.js';
import { CatalogService } from '@/catalog/catalog.service.js';
import { MatchesModule } from '@/matches/matches.module.js';

@Module({
  imports: [MatchesModule],
  controllers: [CatalogController],
  providers: [CatalogService],
})
export class CatalogModule {}
