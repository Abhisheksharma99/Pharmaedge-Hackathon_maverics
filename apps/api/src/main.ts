import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from './app.module.js';
import { configureApp } from './app.setup.js';

async function bootstrap() {
  // trustProxy trusts only the nearest hop: exactly one proxy (nginx) sits in front and overwrites X-Forwarded-For with the peer address, so the
  // client IP (used by the login rate limit) cannot be chosen by the client.
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter({ trustProxy: (_addr, hop) => hop === 0 }));
  await configureApp(app);
  await app.listen(process.env.PORT ?? 3000, '0.0.0.0');
}
await bootstrap();
