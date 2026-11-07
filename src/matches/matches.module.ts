import { Module } from '@nestjs/common';
import { MatchSelectorService } from '@/matches/match-selector.service.js';
import { PlayerKeysService } from '@/matches/player-keys.service.js';
import { SidePickerService } from '@/matches/side-picker.service.js';
import { SquadLoaderService } from '@/matches/squad-loader.service.js';

@Module({
  providers: [
    MatchSelectorService,
    PlayerKeysService,
    SidePickerService,
    SquadLoaderService,
  ],
  exports: [
    MatchSelectorService,
    PlayerKeysService,
    SidePickerService,
    SquadLoaderService,
  ],
})
export class MatchesModule {}
