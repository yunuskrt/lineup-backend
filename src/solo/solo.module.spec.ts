import { SoloModule, SWEEP_EVERY_MS } from '@/solo/solo.module.js';
import type { SoloService } from '@/solo/solo.service.js';

describe('SoloModule', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function moduleWith(sweep = vi.fn().mockResolvedValue(undefined)) {
    const solo = { sweep } as unknown as SoloService;
    return { module: new SoloModule(solo), sweep };
  }

  it('sweeps every minute', async () => {
    const { module, sweep } = moduleWith();
    module.onModuleInit();

    await vi.advanceTimersByTimeAsync(SWEEP_EVERY_MS - 1);
    expect(sweep).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(sweep).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(SWEEP_EVERY_MS);
    expect(sweep).toHaveBeenCalledTimes(2);
    module.onModuleDestroy();
  });

  it('keeps sweeping after a sweep fails', async () => {
    const sweep = vi.fn().mockRejectedValueOnce(new Error('down'));
    sweep.mockResolvedValue(undefined);
    const { module } = moduleWith(sweep);
    module.onModuleInit();

    await vi.advanceTimersByTimeAsync(2 * SWEEP_EVERY_MS);
    expect(sweep).toHaveBeenCalledTimes(2);
    module.onModuleDestroy();
  });

  it('stops sweeping once destroyed', async () => {
    const { module, sweep } = moduleWith();
    module.onModuleInit();
    module.onModuleDestroy();

    await vi.advanceTimersByTimeAsync(3 * SWEEP_EVERY_MS);
    expect(sweep).not.toHaveBeenCalled();
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
