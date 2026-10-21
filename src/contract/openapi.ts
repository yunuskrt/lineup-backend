import { z } from 'zod';
import '@/contract/auth.js';
import '@/contract/catalog.js';
import '@/contract/duel.js';
import '@/contract/profile.js';
import { socketCatalog } from '@/contract/socket.js';
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

const refTo = (id: string) => ({ $ref: componentRef(id) });

// The socket contract, as refs into components
export function socketDoc() {
  const { commands, events } = socketCatalog();
  return {
    commands: Object.fromEntries(
      Object.entries(commands).map(([command, entry]) => [
        command,
        {
          payload: entry.payload === null ? null : refTo(entry.payload),
          ack: refTo(entry.ack),
          refusals: entry.refusals,
        },
      ]),
    ),
    events: Object.fromEntries(
      Object.entries(events).map(([event, id]) => [event, refTo(id)]),
    ),
  };
}
