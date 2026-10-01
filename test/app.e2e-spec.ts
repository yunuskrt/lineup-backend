import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from '@/app.module.js';
import { ENV } from '@/config/config.module.js';
import { loadEnv } from '@/config/load-env.js';
import { PrismaService } from '@/prisma/prisma.service.js';

describe('AppModule (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication({ bodyParser: false });
    await app.init();
  });

  it('boots and answers an unknown route with 404', () => {
    return request(app.getHttpServer()).get('/').expect(404);
  });

  it('provides the parsed environment through ENV', () => {
    const env = loadEnv();
    if (!env.success) throw new Error('expected a valid test environment');
    expect(app.get(ENV)).toBe(env.data);
  });

  it('reaches the Neon dev branch through PrismaService', async () => {
    const prisma = app.get(PrismaService);
    const rows = await prisma.$queryRaw<
      { database: string }[]
    >`SELECT current_database() AS database`;
    expect(rows).toEqual([{ database: expect.any(String) }]);
  });

  afterEach(async () => {
    await app.close();
  });
});
