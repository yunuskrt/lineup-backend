import { Injectable, PipeTransform } from '@nestjs/common';
import type { z } from 'zod';
import { ApiException } from '@/common/api-exception.js';

@Injectable()
export class ZodValidationPipe<T extends z.ZodType> implements PipeTransform {
  constructor(private readonly schema: T) {}

  transform(value: unknown): z.output<T> {
    const result = this.schema.safeParse(value);
    if (result.success) return result.data;

    // Field names only; values may be anything
    const fields = [
      ...new Set(result.error.issues.map((issue) => issue.path.join('.'))),
    ].filter(Boolean);
    const message = fields.length
      ? `Check these fields: ${fields.join(', ')}.`
      : 'The request was not valid.';
    throw new ApiException('invalid_input', message);
  }
}
