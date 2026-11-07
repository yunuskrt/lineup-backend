import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { Logger } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { firstValueFrom, of } from 'rxjs';
import { z } from 'zod';
import { ApiException } from '@/common/api-exception.js';
import {
  ContractResponse,
  ContractResponseInterceptor,
  DirectResponse,
} from '@/common/contract-response.js';
import { contractRegistry } from '@/contract/registry.js';

const shape = z
  .object({ n: z.number() })
  .register(contractRegistry, { id: 'ContractResponseSpecShape' });

class Routes {
  @ContractResponse(shape)
  checked() {}

  @DirectResponse(shape)
  direct() {}

  unmarked() {}
}

const contextOf = (handler: keyof Routes) =>
  ({
    getType: () => 'http',
    getClass: () => Routes,
    getHandler: () => Routes.prototype[handler],
  }) as unknown as ExecutionContext;

const handled = (value: unknown): CallHandler => ({ handle: () => of(value) });

describe('ContractResponseInterceptor', () => {
  const interceptor = new ContractResponseInterceptor(new Reflector());

  beforeEach(() => {
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('wraps a checked route in the envelope', async () => {
    const out = interceptor.intercept(contextOf('checked'), handled({ n: 1 }));
    await expect(firstValueFrom(out)).resolves.toEqual({
      success: true,
      data: { n: 1 },
    });
  });

  it('leaves a direct route to send its own body', async () => {
    const out = interceptor.intercept(contextOf('direct'), handled(undefined));
    await expect(firstValueFrom(out)).resolves.toBeUndefined();
  });

  it('still fails closed on a route with neither marker', () => {
    expect(() =>
      interceptor.intercept(contextOf('unmarked'), handled({ n: 1 })),
    ).toThrow(ApiException);
  });
});
