import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from './app.module.js';
import { FASTIFY_OPTIONS, configureApp } from './app.setup.js';

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter(FASTIFY_OPTIONS));
  await configureApp(app);
  await app.listen(process.env.PORT ?? 3000, '0.0.0.0');
}
await bootstrap();
