import { isSupportedProtocol, PROTOCOL_VERSION } from '@/contract/protocol.js';

describe('isSupportedProtocol', () => {
  it('accepts the current version', () => {
    expect(isSupportedProtocol(PROTOCOL_VERSION)).toBe(true);
  });

  it.each([
    ['N', 5, true],
    ['N-1', 4, true],
    ['N-2', 3, false],
    ['N+1', 6, false],
  ])('at N = 5, %s is %s', (_, version, expected) => {
    expect(isSupportedProtocol(version, 5)).toBe(expected);
  });

  it('never accepts a version below 1', () => {
    expect(isSupportedProtocol(0, 1)).toBe(false);
    expect(isSupportedProtocol(1, 1)).toBe(true);
  });

  it.each([
    ['negative', -1],
    ['fractional', 0.5 + PROTOCOL_VERSION],
    ['a string', String(PROTOCOL_VERSION)],
    ['NaN', Number.NaN],
    ['missing', undefined],
    ['null', null],
  ])('refuses a version that is %s', (_, version) => {
    expect(isSupportedProtocol(version)).toBe(false);
  });
});
