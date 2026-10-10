import { vi } from 'vitest';
import { ValkeyService } from '../src/valkey/valkey.service.js';
import { AnalyticsBuildService } from '../src/analytics/analytics.build.service.js';
import { NotesFinderService } from '../src/annotations/notes-finder.service.js';
import {
  ADMIN,
  closeTestApp,
  cookiesOf,
  createTestApp,
  type TestContext,
} from './helpers/test-app.js';

let ctx: TestContext;
let admin: Record<string, string>;
let analyst: Record<string, string>;
const call = (cookies: Record<string, string>, url: string, payload: object) =>
  ctx.app.inject({ method: 'POST', url, cookies, payload });

beforeAll(async () => {
  ctx = await createTestApp({
    AI_RATE_PER_MINUTE: '3',
    AI_RATE_PER_HOUR: '100',
  });
  const login = async (email: string, password: string) =>
    cookiesOf(
      await ctx.app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { email, password },
      }),
    );
  admin = await login(ADMIN.email, ADMIN.password);
  await call(admin, '/api/users', {
    email: 'ana@example.com',
    name: 'Ana Lyst',
    password: 'analyst-password-1',
    role: 'analyst',
  });
  analyst = await login('ana@example.com', 'analyst-password-1');
  vi.spyOn(ctx.app.get(NotesFinderService), 'find').mockResolvedValue({
    kind: 'none',
  } as never);
  vi.spyOn(ctx.app.get(AnalyticsBuildService), 'start').mockResolvedValue({
    runId: 'r1',
  } as never);
});
afterAll(() => closeTestApp(ctx));

describe('per-user limits on the AI routes', () => {
  it.each([
    ['notes/find', '/api/assets/trep/notes/find', { title: 'ok' }],
    ['analytics/build', '/api/assets/trep/analytics/build', { request: 'x' }],
  ])(
    '%s: 429 with a clear message past the limit, other users unaffected',
    async (_name, url, body) => {
      const statuses: number[] = [];
      for (let i = 0; i < 4; i++)
        statuses.push((await call(admin, url, body)).statusCode);
      expect(statuses.slice(0, 3).every((s) => s < 300)).toBe(true);
      expect(statuses[3]).toBe(429);
      const blocked = await call(admin, url, body);
      expect(blocked.json()).toMatchObject({
        statusCode: 429,
        code: 'TOO_MANY_REQUESTS',
        message: expect.stringMatching(/too quickly/i),
      });
      expect((await call(analyst, url, body)).statusCode).toBeLessThan(300);
    },
  );

  it('counts in Valkey, so the limit holds across API processes', async () => {
    const valkey = ctx.app.get(ValkeyService);
    const keys = (await valkey.client.keys(valkey.key('throttle', 'ai_minute', '*')));
    const counts = await Promise.all(keys.map(async (k) => Number(await valkey.client.get(k))));
    expect(Math.max(...counts)).toBeGreaterThanOrEqual(3);
  });
});
