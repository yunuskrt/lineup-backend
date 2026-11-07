import { Inject, Injectable } from '@nestjs/common';
import { ENV } from '@/config/config.module.js';
import type { Env } from '@/config/env.schema.js';
import {
  deriveDirectorySecret,
  directoryKeyOf,
  secretFingerprint,
} from '@/matches/directory-key.js';

// Shared by reveals and the directory (R5)
@Injectable()
export class PlayerKeysService {
  private readonly secret: Buffer;
  readonly fingerprint: string;

  constructor(@Inject(ENV) env: Env) {
    this.secret = deriveDirectorySecret(env.BETTER_AUTH_SECRET);
    this.fingerprint = secretFingerprint(this.secret);
  }

  keyOf(playerId: string): string {
    return directoryKeyOf(this.secret, playerId);
  }
}
