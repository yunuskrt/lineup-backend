import { Module } from '@nestjs/common';
import { MatchSelectorService } from '@/matches/match-selector.service.js';
import { SidePickerService } from '@/matches/side-picker.service.js';
import { SquadLoaderService } from '@/matches/squad-loader.service.js';

@Module({
  providers: [MatchSelectorService, SidePickerService, SquadLoaderService],
  exports: [MatchSelectorService, SidePickerService, SquadLoaderService],
})
export class MatchesModule {}
