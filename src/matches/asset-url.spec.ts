import { assetUrl } from '@/matches/asset-url.js';

const BASE = 'https://bucket.example.com/images';
const KEY = 'crests/yildiz/0123456789ab.webp';

describe('assetUrl', () => {
  it('is null without a base', () => {
    expect(assetUrl(undefined, KEY)).toBeNull();
  });

  it('is null without a key', () => {
    expect(assetUrl(BASE, null)).toBeNull();
  });

  it('joins the base and the key', () => {
    expect(assetUrl(BASE, KEY)).toBe(`${BASE}/${KEY}`);
  });
});
