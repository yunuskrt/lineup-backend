import { RUN_IDLE_MS } from '@/solo/solo-run.js';
import { SoloSessionStore } from '@/solo/solo-session.store.js';
import {
  guess,
  NAMES,
  offeredRun,
  playedRun,
  T0,
} from '@/solo/solo.fixtures.js';

const QUIT = { kind: 'quit' } as const;

describe('SoloSessionStore', () => {
  it('returns a run to its owner', () => {
    const store = new SoloSessionStore();
    const run = offeredRun();
    store.save(run);
    expect(store.get('run-1', 'user-1')).toBe(run);
  });

  it('hides a run from another user', () => {
    const store = new SoloSessionStore();
    store.save(offeredRun());
    expect(store.get('run-1', 'user-2')).toBeUndefined();
  });

  it('misses an unknown id', () => {
    expect(new SoloSessionStore().get('nope', 'user-1')).toBeUndefined();
  });

  it('replaces a run on save', () => {
    const store = new SoloSessionStore();
    store.save(offeredRun());
    const played = playedRun();
    store.save(played);
    expect(store.get('run-1', 'user-1')).toBe(played);
  });

  it('finds the active run of a user, offered or in play', () => {
    const store = new SoloSessionStore();
    store.save(offeredRun({ id: 'other', userId: 'user-2' }));
    expect(store.activeOf('user-1')).toBeUndefined();

    store.save(offeredRun());
    expect(store.activeOf('user-1')?.id).toBe('run-1');

    store.save(playedRun([guess(NAMES[0]), 100]));
    expect(store.activeOf('user-1')?.id).toBe('run-1');
  });

  it('skips a run that is over', () => {
    const store = new SoloSessionStore();
    store.save(playedRun([QUIT, 100]));
    expect(store.activeOf('user-1')).toBeUndefined();
  });

  it('drops a run', () => {
    const store = new SoloSessionStore();
    store.save(offeredRun());
    store.drop('run-1');
    expect(store.get('run-1', 'user-1')).toBeUndefined();
  });

  it('evicts only runs idle for the whole window', () => {
    const store = new SoloSessionStore();
    store.save(offeredRun({ id: 'old', touchedAt: T0 }));
    store.save(offeredRun({ id: 'fresh', touchedAt: T0 + 1 }));

    expect(store.evictIdle(T0 + RUN_IDLE_MS)).toBe(1);
    expect(store.get('old', 'user-1')).toBeUndefined();
    expect(store.get('fresh', 'user-1')).toBeDefined();
  });

  it('marks the latest copy saved, and skips a run gone or unplayed', () => {
    const store = new SoloSessionStore();
    store.save(offeredRun({ id: 'offer' }));
    store.save({ ...playedRun(), id: 'played' });

    store.markSaved('played', T0 + 5);
    store.markSaved('offer', T0 + 5);
    store.markSaved('gone', T0 + 5);

    expect(store.get('played', 'user-1')).toMatchObject({ savedAt: T0 + 5 });
    expect(store.get('offer', 'user-1')).not.toHaveProperty('savedAt');
    expect(store.get('gone', 'user-1')).toBeUndefined();
  });

  it('lists only runs with a side for the sweep', () => {
    const store = new SoloSessionStore();
    store.save(offeredRun({ id: 'offer' }));
    store.save({ ...playedRun(), id: 'played' });
    expect(store.played().map((run) => run.id)).toEqual(['played']);
  });

  it('keeps an idle run that is over but unsaved', () => {
    const store = new SoloSessionStore();
    store.save({ ...playedRun([QUIT, 100]), touchedAt: T0 });
    expect(store.evictIdle(T0 + RUN_IDLE_MS)).toBe(0);
    expect(store.get('run-1', 'user-1')).toBeDefined();
  });
});
