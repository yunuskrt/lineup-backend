import {
  applyDecorators,
  CallHandler,
  ExecutionContext,
  HttpCode,
  HttpStatus,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ApiOkResponse } from '@nestjs/swagger';
import { map, type Observable } from 'rxjs';
import { z } from 'zod';
import { ApiException, SERVER_ERROR_MESSAGE } from '@/common/api-exception.js';
import { componentRef } from '@/contract/openapi.js';
import { contractRegistry } from '@/contract/registry.js';

const ResponseSchema = Reflector.createDecorator<z.ZodType>();

function successDoc(schema: z.ZodType) {
  if (schema instanceof z.ZodNull) return { $ref: componentRef('EmptyResult') };

  const id = contractRegistry.get(schema)?.id;
  if (!id) throw new Error('Response schemas must be named contract types');
  return {
    type: 'object',
    required: ['success', 'data'],
    properties: {
      success: { type: 'boolean', enum: [true] },
      data: { $ref: componentRef(id) },
    },
  };
}

// Every success is 200, POST included, as documented
export function ContractResponse(schema: z.ZodType) {
  return applyDecorators(
    ResponseSchema(schema),
    HttpCode(HttpStatus.OK),
    ApiOkResponse({ schema: successDoc(schema) }),
  );
}

@Injectable()
export class ContractResponseInterceptor implements NestInterceptor {
  private readonly logger = new Logger('ContractResponse');

  constructor(private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();

    const route = `${context.getClass().name}.${context.getHandler().name}`;
    const schema = this.reflector.get(ResponseSchema, context.getHandler());
    // Fail closed: an undeclared shape could leak
    if (!schema) {
      this.logger.error(`${route} has no @ContractResponse`);
      throw new ApiException('server_error', SERVER_ERROR_MESSAGE);
    }

    return next.handle().pipe(
      map((value: unknown) => {
        const result = schema.safeParse(value ?? null);
        if (result.success) return { success: true, data: result.data };

        // Paths and codes only: the value may hold a squad
        const issues = result.error.issues
          .map((issue) => `${issue.path.join('.')}:${issue.code}`)
          .join(', ');
        this.logger.error(`${route} returned an off-contract value: ${issues}`);
        throw new ApiException('server_error', SERVER_ERROR_MESSAGE);
      }),
    );
  }
}
