import { z } from 'zod';
import '@/contract/auth.js';
import '@/contract/catalog.js';
import '@/contract/duel.js';
import '@/contract/profile.js';
import '@/contract/solo.js';
import { contractRegistry } from '@/contract/registry.js';

const toOpenApi = () =>
  z.toJSONSchema(contractRegistry, {
    target: 'openapi-3.0',
    uri: (id) => `#/components/schemas/${id}`,
  }).schemas;

describe('contractRegistry', () => {
  it('rejects a second schema under an existing id', () => {
    expect(() =>
      z.string().register(contractRegistry, { id: 'MatchInPlay' }),
    ).toThrow('Duplicate contract schema id: MatchInPlay');
  });

  it('exposes the core contract types', () => {
    expect(Object.keys(toOpenApi())).toEqual(
      expect.arrayContaining([
        'ApiError',
        'MatchInPlay',
        'SoloSession',
        'SoloSummary',
        'DuelSession',
        'DuelResult',
        'HistoryPage',
        'Profile',
        'FilterOptions',
      ]),
    );
  });

  it('resolves every $ref to a registered component', () => {
    const schemas = toOpenApi();
    const refs = JSON.stringify(schemas).match(/#\/components\/schemas\/\w+/g);
    expect(refs).not.toBeNull();
    for (const ref of new Set(refs)) {
      expect(schemas).toHaveProperty(ref.split('/').pop() as string);
    }
  });
});
