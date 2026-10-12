import { Module } from '@nestjs/common';
import { MatchSelectorService } from '@/matches/match-selector.service.js';
import { SidePickerService } from '@/matches/side-picker.service.js';

@Module({
  providers: [MatchSelectorService, SidePickerService],
  exports: [MatchSelectorService, SidePickerService],
})
export class MatchesModule {}
