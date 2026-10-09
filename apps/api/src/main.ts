import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from './app.module.js';
import { configureApp } from './app.setup.js';

async function bootstrap() {
  // trustProxy: nginx sits in front, so the client IP (used by the login rate limit) comes from X-Forwarded-For.
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter({ trustProxy: true }));
  await configureApp(app);
  await app.listen(process.env.PORT ?? 3000, '0.0.0.0');
}
await bootstrap();
