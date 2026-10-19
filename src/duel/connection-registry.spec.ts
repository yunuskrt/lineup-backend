import { ConnectionRegistry } from '@/duel/connection-registry.js';

type FakeSocket = { id: string };

describe('ConnectionRegistry', () => {
  let registry: ConnectionRegistry<FakeSocket>;
  const first = { id: 's-1' };
  const second = { id: 's-2' };

  beforeEach(() => {
    registry = new ConnectionRegistry<FakeSocket>();
  });

  it("registers a user's first socket, replacing nothing", () => {
    expect(registry.register('u-1', first)).toBeNull();
    expect(registry.socketOf('u-1')).toBe(first);
  });

  it('hands back the socket a newer one replaced', () => {
    registry.register('u-1', first);
    expect(registry.register('u-1', second)).toBe(first);
    expect(registry.socketOf('u-1')).toBe(second);
  });

  it('replaces nothing when the same socket registers again', () => {
    registry.register('u-1', first);
    expect(registry.register('u-1', first)).toBeNull();
  });

  it('keeps users apart', () => {
    registry.register('u-1', first);
    expect(registry.register('u-2', second)).toBeNull();
    expect(registry.socketOf('u-1')).toBe(first);
  });

  it('removes the current socket, and says so', () => {
    registry.register('u-1', first);
    expect(registry.remove('u-1', first)).toBe(true);
    expect(registry.socketOf('u-1')).toBeNull();
  });

  it('leaves the newer socket when a replaced one closes', () => {
    registry.register('u-1', first);
    registry.register('u-1', second);
    expect(registry.remove('u-1', first)).toBe(false);
    expect(registry.socketOf('u-1')).toBe(second);
  });

  it('removes nothing for an unknown user', () => {
    expect(registry.remove('u-9', first)).toBe(false);
  });

  it('knows no socket for an unknown user', () => {
    expect(registry.socketOf('u-9')).toBeNull();
  });
});
