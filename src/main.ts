import { NestFactory } from '@nestjs/core';
import { AppModule } from '@/app.module.js';

async function bootstrap() {
  // Better Auth parses its own bodies (B10)
  const app = await NestFactory.create(AppModule, { bodyParser: false });
  await app.listen(process.env.PORT ?? 8080);
}
await bootstrap();
