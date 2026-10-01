import { z } from 'zod';

type ContractMeta = { id: string };

// Zod lets a second id overwrite the first silently
class ContractRegistry extends z.core.$ZodRegistry<ContractMeta> {
  override add<S extends z.core.$ZodType>(
    schema: S,
    ...meta: [ContractMeta]
  ): this {
    const [{ id }] = meta;
    if (this._idmap.has(id)) {
      throw new Error(`Duplicate contract schema id: ${id}`);
    }
    return super.add(schema, ...meta);
  }
}

export const contractRegistry = new ContractRegistry();
