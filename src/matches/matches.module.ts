import { Module } from '@nestjs/common';
import { MatchSelectorService } from '@/matches/match-selector.service.js';
import { PlayerKeysService } from '@/matches/player-keys.service.js';
import { SidePickerService } from '@/matches/side-picker.service.js';
import { LANDING_SHOWCASE, SHOWCASE } from '@/matches/showcase.js';
import { SquadLoaderService } from '@/matches/squad-loader.service.js';

@Module({
  providers: [
    MatchSelectorService,
    PlayerKeysService,
    SidePickerService,
    SquadLoaderService,
    { provide: SHOWCASE, useValue: LANDING_SHOWCASE },
  ],
  exports: [
    MatchSelectorService,
    PlayerKeysService,
    SidePickerService,
    SquadLoaderService,
    SHOWCASE,
  ],
})
export class MatchesModule {}
