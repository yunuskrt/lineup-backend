import { Module } from '@nestjs/common';
import { MatchSelectorService } from '@/matches/match-selector.service.js';

@Module({
  providers: [MatchSelectorService],
  exports: [MatchSelectorService],
})
export class MatchesModule {}
