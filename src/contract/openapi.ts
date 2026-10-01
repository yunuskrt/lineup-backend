import { z } from 'zod';
import '@/contract/auth.js';
import '@/contract/catalog.js';
import '@/contract/duel.js';
import '@/contract/profile.js';
import '@/contract/solo.js';
import { contractRegistry } from '@/contract/registry.js';

export type ComponentSchema = z.core.JSONSchema.BaseSchema;

export const componentRef = (id: string) => `#/components/schemas/${id}`;

// Input view: open to fields added later
export function contractComponents(): Record<string, ComponentSchema> {
  const { schemas } = z.toJSONSchema(contractRegistry, {
    target: 'openapi-3.0',
    io: 'input',
    uri: componentRef,
  });
  return Object.fromEntries(
    Object.entries(schemas).map(([id, schema]) => {
      const component = { ...schema };
      delete component.$id;
      return [id, component];
    }),
  );
}
