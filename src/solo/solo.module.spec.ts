import type { Clock } from '@/common/clock.js';
import { SoloModule } from '@/solo/solo.module.js';
import type { SoloSessionStore } from '@/solo/solo-session.store.js';

const FIVE_MINUTES = 5 * 60_000;

describe('SoloModule', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function moduleWith() {
    const evictIdle = vi.fn();
    const clock: Clock & { at: number } = { at: 42, now: () => clock.at };
    const store = { evictIdle } as unknown as SoloSessionStore;
    return { module: new SoloModule(store, clock), evictIdle, clock };
  }

  it('evicts idle runs every five minutes, by the clock', () => {
    const { module, evictIdle, clock } = moduleWith();
    module.onModuleInit();

    vi.advanceTimersByTime(FIVE_MINUTES - 1);
    expect(evictIdle).not.toHaveBeenCalled();

    clock.at = 1_000;
    vi.advanceTimersByTime(1);
    expect(evictIdle).toHaveBeenCalledWith(1_000);

    vi.advanceTimersByTime(FIVE_MINUTES);
    expect(evictIdle).toHaveBeenCalledTimes(2);
    module.onModuleDestroy();
  });

  it('stops evicting once destroyed', () => {
    const { module, evictIdle } = moduleWith();
    module.onModuleInit();
    module.onModuleDestroy();

    vi.advanceTimersByTime(3 * FIVE_MINUTES);
    expect(evictIdle).not.toHaveBeenCalled();
  });

  it('never keeps the process alive on its own', () => {
    const setInterval = vi.spyOn(globalThis, 'setInterval');
    const { module } = moduleWith();
    module.onModuleInit();

    const timer = setInterval.mock.results[0].value as NodeJS.Timeout;
    expect(timer.hasRef()).toBe(false);
    module.onModuleDestroy();
    setInterval.mockRestore();
  });
});
