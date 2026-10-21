import {
  DUEL_COMMAND_REFUSALS,
  duelCommandSchemas,
  duelEventSchemas,
} from '@/contract/duel.js';
import { contractComponents, socketDoc } from '@/contract/openapi.js';
import { socketCatalog } from '@/contract/socket.js';

describe('socketCatalog', () => {
  const catalog = socketCatalog();

  it('lists every command and nothing else', () => {
    expect(Object.keys(catalog.commands)).toEqual(
      Object.keys(duelCommandSchemas),
    );
  });

  it('lists every event and nothing else', () => {
    expect(Object.keys(catalog.events)).toEqual(Object.keys(duelEventSchemas));
    expect(Object.keys(catalog.events)).toHaveLength(15);
  });

  it('names each payload, null when a command takes none', () => {
    expect(catalog.commands['filters:submit'].payload).toBe('Filters');
    expect(catalog.commands['duel:guess'].payload).toBe('DuelGuessRequest');
    expect(catalog.commands['queue:enter'].payload).toBeNull();
    expect(catalog.events.matchReady).toBe('DuelSession');
    expect(catalog.events.error).toBe('ApiError');
  });

  it('names only components the document has', () => {
    const components = Object.keys(contractComponents());
    const ids = [
      ...Object.values(catalog.commands).flatMap((c) => [c.payload, c.ack]),
      ...Object.values(catalog.events),
    ].filter((id): id is string => id !== null);
    for (const id of ids) expect(components).toContain(id);
  });

  it('lets every command fail as invalid_input or server_error', () => {
    for (const refusals of Object.values(DUEL_COMMAND_REFUSALS)) {
      expect(refusals).toContain('invalid_input');
      expect(refusals).toContain('server_error');
    }
  });

  it('carries the refusals each command can send', () => {
    expect(catalog.commands['filters:submit'].refusals).toContain('empty_pool');
    expect(catalog.commands['duel:guess'].refusals).toEqual(
      expect.arrayContaining(['session_over', 'forbidden', 'rate_limited']),
    );
  });
});

describe('socketDoc', () => {
  const doc = socketDoc();

  it('turns every id into a ref into components', () => {
    expect(doc.commands['duel:guess']).toEqual({
      payload: { $ref: '#/components/schemas/DuelGuessRequest' },
      ack: { $ref: '#/components/schemas/EmptyResult' },
      refusals: DUEL_COMMAND_REFUSALS['duel:guess'],
    });
    expect(doc.events.lifeLost).toEqual({
      $ref: '#/components/schemas/DuelLifeLost',
    });
  });

  it('keeps a missing payload as null, not a ref', () => {
    expect(doc.commands['duel:forfeit'].payload).toBeNull();
  });

  it('covers the same commands and events as the catalogue', () => {
    const catalog = socketCatalog();
    expect(Object.keys(doc.commands)).toEqual(Object.keys(catalog.commands));
    expect(Object.keys(doc.events)).toEqual(Object.keys(catalog.events));
  });
});
