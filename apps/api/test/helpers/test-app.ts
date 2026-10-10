import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import { MongoMemoryServer } from 'mongodb-memory-server';

export const ADMIN = { email: 'admin@example.com', password: 'admin-password-123', name: 'Test Admin' };

export interface TestContext {
  app: NestFastifyApplication;
  mongo: MongoMemoryServer;
}

/**
 * Boot the real AppModule against an in-memory MongoDB and the dev Valkey
 * (unique key prefix per run). Env must be set before AppModule is imported,
 * because ConfigModule validates it at import time — hence the dynamic import.
 */
export async function createTestApp(env: Record<string, string> = {}): Promise<TestContext> {
  const mongo = await MongoMemoryServer.create();
  Object.assign(process.env, {
    NODE_ENV: 'test',
    MONGODB_URI: mongo.getUri(),
    MONGODB_DB: 'asset_journey_test',
    VALKEY_URL: 'redis://localhost:6380',
    VALKEY_PREFIX: `aj:test:${randomUUID()}:`,
    JWT_SECRET: 'test-secret-that-is-at-least-32-characters-long',
    ADMIN_EMAIL: ADMIN.email,
    ADMIN_PASSWORD: ADMIN.password,
    ADMIN_NAME: ADMIN.name,
    CRAWLER_SERVICE_KEY: 'test-service-key-0123456789',
    AI_RATE_PER_MINUTE: '1000',
    AI_RATE_PER_HOUR: '10000',
    ...env,
  });
  const { AppModule } = await import('../../src/app.module.js');
  const { configureApp, FASTIFY_OPTIONS } = await import('../../src/app.setup.js');
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter(FASTIFY_OPTIONS));
  await configureApp(app);
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  return { app, mongo };
}

export async function closeTestApp(ctx: TestContext | undefined) {
  // ctx is undefined when setup itself failed; don't mask that error.
  await ctx?.app.close();
  await ctx?.mongo.stop();
}

/** Cookies set by a response, keyed by name. */
export function cookiesOf(res: { cookies: Array<{ name: string; value: string }> }): Record<string, string> {
  return Object.fromEntries(res.cookies.map((c) => [c.name, c.value]));
}
