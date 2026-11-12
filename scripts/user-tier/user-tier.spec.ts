import { parseTierArgs, USAGE } from '@scripts/user-tier/user-tier.js';

describe('parseTierArgs', () => {
  it('reads an argument with an @ as an email, lowercased', () => {
    expect(parseTierArgs(['Fan@Lineup.GG', 'pro'])).toEqual({
      success: true,
      data: { target: { email: 'fan@lineup.gg' }, tier: 'pro' },
    });
  });

  it('reads anything else as a handle, case kept', () => {
    expect(parseTierArgs(['guest-4821', 'free'])).toEqual({
      success: true,
      data: { target: { handle: 'guest-4821' }, tier: 'free' },
    });
  });

  it.each([[[]], [['fan_05']], [['fan_05', 'pro', 'extra']], [['', 'pro']]])(
    'refuses %j with the usage',
    (argv) => {
      expect(parseTierArgs(argv)).toEqual({ success: false, error: USAGE });
    },
  );

  it.each(['gold', 'PRO', 'Free'])('refuses the tier %j', (tier) => {
    const result = parseTierArgs(['fan_05', tier]);
    expect(result.success).toBe(false);
    expect(!result.success && result.error).toContain(`Unknown tier "${tier}"`);
  });
});
