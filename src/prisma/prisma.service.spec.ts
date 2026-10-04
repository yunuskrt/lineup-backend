import type { Env } from '@/config/env.schema.js';
import { PrismaService } from '@/prisma/prisma.service.js';

const env: Env = {
  NODE_ENV: 'test',
  PORT: 8080,
  DATABASE_URL: 'postgresql://u:p@db.example.com/neondb',
  BETTER_AUTH_SECRET: 'k'.repeat(32),
  BETTER_AUTH_URL: 'http://localhost:8080',
  WEB_APP_URL: 'http://localhost:3000',
  MAIL_FROM: 'Lineup <onboarding@resend.dev>',
};

describe('PrismaService', () => {
  let service: PrismaService;

  beforeEach(() => {
    // The pg pool is lazy: no network here
    service = new PrismaService(env);
  });

  it('runs a real query at startup, not just $connect()', async () => {
    const connect = vi.spyOn(service, '$connect').mockResolvedValue();
    const query = vi.spyOn(service, '$queryRaw').mockResolvedValue([]);

    await service.onModuleInit();

    expect(connect).toHaveBeenCalledOnce();
    expect(query).toHaveBeenCalledOnce();
  });

  it('fails startup when the probe query fails', async () => {
    vi.spyOn(service, '$connect').mockResolvedValue();
    vi.spyOn(service, '$queryRaw').mockRejectedValue(
      new Error("Can't reach database server"),
    );

    await expect(service.onModuleInit()).rejects.toThrow(
      "Can't reach database server",
    );
  });

  it('disconnects on shutdown', async () => {
    const disconnect = vi.spyOn(service, '$disconnect').mockResolvedValue();
    await service.onModuleDestroy();
    expect(disconnect).toHaveBeenCalledOnce();
  });
});
