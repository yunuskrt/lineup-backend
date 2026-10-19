import { DuelNotifier, roomOf } from '@/duel/duel-notifier.js';
import type { DuelServer } from '@/duel/duel.gateway.js';

describe('DuelNotifier', () => {
  it("emits to the user's room", () => {
    const emit = vi.fn();
    const to = vi.fn().mockReturnValue({ emit });
    const notifier = new DuelNotifier();
    notifier.attach({ to } as unknown as DuelServer);

    notifier.toUser('u-1', 'queued', { phase: 'queued', since: 7 });

    expect(to).toHaveBeenCalledWith('user:u-1');
    expect(emit).toHaveBeenCalledWith('queued', { phase: 'queued', since: 7 });
  });

  it('refuses to emit before the gateway attaches', () => {
    expect(() =>
      new DuelNotifier().toUser('u-1', 'queued', { phase: 'queued', since: 0 }),
    ).toThrow();
  });

  it('names the room after the user', () => {
    expect(roomOf('u-1')).toBe('user:u-1');
  });
});
