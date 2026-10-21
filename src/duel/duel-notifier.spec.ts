import { Logger } from '@nestjs/common';
import { SERVER_ERROR_MESSAGE } from '@/common/api-exception.js';
import { duelFoundPlayer } from '@/contract/contract.fixtures.js';
import type { DuelFoundPlayer } from '@/contract/player.js';
import { DuelNotifier, roomOf } from '@/duel/duel-notifier.js';
import type { DuelServer, DuelSocket } from '@/duel/duel.gateway.js';

const SERVER_ERROR = {
  code: 'server_error',
  message: SERVER_ERROR_MESSAGE,
  retryAfterMs: null,
};

function attached() {
  const emit = vi.fn();
  const to = vi.fn().mockReturnValue({ emit });
  const notifier = new DuelNotifier();
  notifier.attach({ to } as unknown as DuelServer);
  return { notifier, to, emit };
}

describe('DuelNotifier', () => {
  afterEach(() => vi.restoreAllMocks());

  it("emits to the user's room", () => {
    const { notifier, to, emit } = attached();
    notifier.toUser('u-1', 'queued', { phase: 'queued', since: 7 });

    expect(to).toHaveBeenCalledWith('user:u-1');
    expect(emit).toHaveBeenCalledWith('queued', { phase: 'queued', since: 7 });
  });

  it('strips a key the contract does not have', () => {
    const { notifier, emit } = attached();
    // A squad field a view must never add
    const leaky = { ...duelFoundPlayer, aliases: ['secret'] };
    notifier.toUser('u-1', 'playerRevealed', leaky as DuelFoundPlayer);

    expect(emit).toHaveBeenCalledWith('playerRevealed', duelFoundPlayer);
    expect(JSON.stringify(emit.mock.calls)).not.toContain('secret');
  });

  it('sends server_error in place of an off-contract payload', () => {
    const { notifier, emit } = attached();
    const logged = vi
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    const broken = { ...duelFoundPlayer, slot: 99, name: 'Secret Name' };
    notifier.toUser('u-1', 'playerRevealed', broken);

    expect(emit).toHaveBeenCalledExactlyOnceWith('error', SERVER_ERROR);
    expect(logged).toHaveBeenCalledExactlyOnceWith(
      'Event playerRevealed broke its contract: slot:too_big',
    );
    expect(JSON.stringify(logged.mock.calls)).not.toContain('Secret');
  });

  it('checks an error event against its contract too', () => {
    const { notifier, emit } = attached();
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    notifier.toUser('u-1', 'error', {
      code: 'not_a_code',
      message: '',
      retryAfterMs: null,
    } as never);
    expect(emit).toHaveBeenCalledExactlyOnceWith('error', SERVER_ERROR);
  });

  it('sends to one socket under the same rule', () => {
    const { notifier } = attached();
    const emit = vi.fn();
    const socket = { emit } as unknown as DuelSocket;
    const replaced = {
      code: 'forbidden',
      message: 'Elsewhere.',
      retryAfterMs: null,
    } as const;

    notifier.toSocket(socket, 'error', replaced);
    expect(emit).toHaveBeenCalledWith('error', replaced);

    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    notifier.toSocket(socket, 'queued', { phase: 'paired' } as never);
    expect(emit).toHaveBeenLastCalledWith('error', SERVER_ERROR);
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
