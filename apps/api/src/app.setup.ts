import fastifyCookie from '@fastify/cookie';
import { ValidationPipe } from '@nestjs/common';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { HttpExceptionFilter } from './common/filters/http-exception.filter.js';

/**
 * Fastify adapter options shared by main.ts and the e2e tests. trustProxy trusts only the nearest hop: exactly one
 * proxy (nginx) sits in front and overwrites X-Forwarded-For with the peer address, so the client IP (login and AI
 * rate limits) cannot be chosen by the client. maxParamLength: event ids embed source URLs and exceed the 100-char
 * router default (longer params get a 414 before Nest runs).
 */
export const FASTIFY_OPTIONS = {
  trustProxy: (_addr: string, hop: number) => hop === 0,
  routerOptions: { maxParamLength: 2048 },
};

/** Everything main.ts and the e2e tests both need, so tests run the real app. */
export async function configureApp(app: NestFastifyApplication): Promise<void> {
  await app.register(fastifyCookie);
  // JSON API: never sniffed, framed or cached by a shared cache (responses are per-user).
  app.getHttpAdapter().getInstance().addHook('onSend', async (_req, reply) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('Referrer-Policy', 'no-referrer');
    if (!reply.hasHeader('Cache-Control')) reply.header('Cache-Control', 'no-store');
  });
  app.setGlobalPrefix('api');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  app.useGlobalFilters(new HttpExceptionFilter());
  app.enableShutdownHooks();

  if (process.env.NODE_ENV !== 'production') {
    const doc = new DocumentBuilder().setTitle('Asset Journey API').setVersion('1').addCookieAuth('aj_access').build();
    SwaggerModule.setup('api/docs', app, SwaggerModule.createDocument(app, doc));
  }
}
