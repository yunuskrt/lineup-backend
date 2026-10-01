import {
  Controller,
  Get,
  INestApplication,
  PayloadTooLargeException,
  Post,
  Query,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { z } from 'zod';
import { AppModule } from '@/app.module.js';
import { ApiException } from '@/common/api-exception.js';
import { ContractResponse } from '@/common/contract-response.js';
import { ZodValidationPipe } from '@/common/zod-validation.pipe.js';
import { apiErrorSchema } from '@/contract/envelope.js';
import {
  historyPageSchema,
  historyQuerySchema,
  type HistoryQuery,
} from '@/contract/profile.js';
import { setupDocs } from '@/docs/setup-docs.js';

@Controller('__test')
class ContractTestController {
  @Get('history')
  @ContractResponse(historyPageSchema)
  history(
    @Query(new ZodValidationPipe(historyQuerySchema)) query: HistoryQuery,
  ) {
    return {
      entries: [],
      nextCursor: `limit-${query.limit}`,
      squad: ['Hidden Starter'],
    };
  }

  @Get('empty')
  @ContractResponse(z.null())
  empty() {
    return undefined;
  }

  @Get('off-contract')
  @ContractResponse(historyPageSchema)
  offContract() {
    return { entries: 'not-a-list', nextCursor: null };
  }

  @Get('undeclared')
  undeclared() {
    return { anything: 'at all' };
  }

  @Get('crash')
  @ContractResponse(z.null())
  crash() {
    throw new Error('connect ECONNREFUSED postgres://admin:hunter2@db');
  }

  @Get('empty-pool')
  @ContractResponse(z.null())
  emptyPool() {
    throw new ApiException('empty_pool', 'No match fits these filters.', {
      emptyBecause: 'era',
    });
  }

  @Get('malformed-error')
  @ContractResponse(z.null())
  malformedError() {
    throw new ApiException('rate_limited', 'Slow down.');
  }

  @Post('create')
  @ContractResponse(z.null())
  create() {
    return null;
  }

  @Get('too-large')
  @ContractResponse(z.null())
  tooLarge() {
    throw new PayloadTooLargeException();
  }
}

const failureSchema = z.object({
  success: z.literal(false),
  error: apiErrorSchema,
});

describe('Contract delivery (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
      controllers: [ContractTestController],
    }).compile();
    app = moduleRef.createNestApplication({ bodyParser: false, logger: false });
    setupDocs(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  const get = (path: string) => request(app.getHttpServer()).get(path);

  const expectFailure = async (path: string, status: number, code: string) => {
    const res = await get(path).expect(status);
    const body = failureSchema.parse(res.body);
    expect(body.error.code).toBe(code);
    return body;
  };

  describe('success envelope', () => {
    it('wraps parsed output and coerces query input', async () => {
      const res = await get('/__test/history?limit=5').expect(200);
      expect(res.body).toEqual({
        success: true,
        data: { entries: [], nextCursor: 'limit-5' },
      });
    });

    it('strips fields the contract does not declare', async () => {
      const res = await get('/__test/history').expect(200);
      expect(res.body.data).not.toHaveProperty('squad');
      expect(JSON.stringify(res.body)).not.toContain('Hidden Starter');
    });

    it('sends data: null for a route that returns nothing', async () => {
      const res = await get('/__test/empty').expect(200);
      expect(res.body).toEqual({ success: true, data: null });
    });

    it('answers a POST with 200, matching the documented status', async () => {
      const res = await request(app.getHttpServer())
        .post('/__test/create')
        .expect(200);
      expect(res.body).toEqual({ success: true, data: null });
    });
  });

  describe('failure envelope', () => {
    it('rejects bad input as invalid_input, naming only the field', async () => {
      const body = await expectFailure(
        '/__test/history?limit=abc',
        400,
        'invalid_input',
      );
      expect(body.error.message).toContain('limit');
      expect(body.error.message).not.toContain('abc');
    });

    it('turns an off-contract response into server_error', async () => {
      const body = await expectFailure(
        '/__test/off-contract',
        500,
        'server_error',
      );
      expect(JSON.stringify(body)).not.toContain('not-a-list');
    });

    it('refuses a route with no declared response schema', async () => {
      const body = await expectFailure(
        '/__test/undeclared',
        500,
        'server_error',
      );
      expect(JSON.stringify(body)).not.toContain('at all');
    });

    it('hides an unexpected crash behind server_error', async () => {
      const res = await get('/__test/crash').expect(500);
      const text = JSON.stringify(res.body);
      expect(failureSchema.parse(res.body).error.code).toBe('server_error');
      for (const leak of ['hunter2', 'ECONNREFUSED', 'stack', 'at ']) {
        expect(text).not.toContain(leak);
      }
    });

    it('passes a known ApiException through with its extras', async () => {
      const body = await expectFailure('/__test/empty-pool', 422, 'empty_pool');
      expect(body.error).toEqual({
        code: 'empty_pool',
        message: 'No match fits these filters.',
        retryAfterMs: null,
        emptyBecause: 'era',
      });
    });

    it('downgrades a malformed ApiException to server_error', async () => {
      await expectFailure('/__test/malformed-error', 500, 'server_error');
    });

    it('answers an unknown route with not_found', async () => {
      await expectFailure('/__test/nowhere', 404, 'not_found');
    });

    it('keeps a framework 413 as a client error, not a server one', async () => {
      await expectFailure('/__test/too-large', 413, 'invalid_input');
    });
  });

  describe('docs', () => {
    it('serves an OpenAPI 3.0 document with every contract component', async () => {
      const res = await get('/docs/openapi.json').expect(200);
      expect(res.body.openapi).toMatch(/^3\.0\./);

      const schemas = res.body.components.schemas;
      for (const id of [
        'MatchInPlay',
        'SoloSession',
        'DuelSession',
        'ApiError',
      ]) {
        expect(schemas).toHaveProperty(id);
        expect(schemas[id]).not.toHaveProperty('$id');
      }

      const refs = JSON.stringify(res.body).match(
        /#\/components\/schemas\/\w+/g,
      );
      for (const ref of new Set(refs)) {
        expect(schemas).toHaveProperty(ref.split('/').pop() as string);
      }
    });

    it('documents a route response as an envelope around its component', async () => {
      const res = await get('/docs/openapi.json').expect(200);
      const ok = res.body.paths['/__test/history'].get.responses['200'];
      expect(ok.content['application/json'].schema.properties.data).toEqual({
        $ref: '#/components/schemas/HistoryPage',
      });
    });

    it('documents a POST success as 200, never 201', async () => {
      const res = await get('/docs/openapi.json').expect(200);
      const responses = res.body.paths['/__test/create'].post.responses;
      expect(Object.keys(responses)).toEqual(['200']);
      expect(responses['200'].content['application/json'].schema).toEqual({
        $ref: '#/components/schemas/EmptyResult',
      });
    });

    it('serves the Swagger UI', async () => {
      const res = await get('/docs').redirects(1).expect(200);
      expect(res.text).toContain('swagger-ui');
    });
  });
});
