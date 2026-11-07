import { createHash, createHmac, hkdfSync } from 'node:crypto';

const LABEL = 'lineup:player-directory';
const KEY_BYTES = 16;

// Its own key: never the auth secret itself
export function deriveDirectorySecret(authSecret: string): Buffer {
  return Buffer.from(hkdfSync('sha256', authSecret, '', LABEL, 32));
}

// Opaque: no creation order, unlike uuid(7) ids
export function directoryKeyOf(secret: Buffer, playerId: string): string {
  return createHmac('sha256', secret)
    .update(playerId)
    .digest()
    .subarray(0, KEY_BYTES)
    .toString('base64url');
}

// One-way: names the secret in an ETag
export function secretFingerprint(secret: Buffer): string {
  return createHash('sha256').update(secret).digest('hex').slice(0, 16);
}
