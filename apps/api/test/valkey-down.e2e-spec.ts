import { AuthService } from '../src/auth/auth.service.js';
import { UsersService } from '../src/users/users.service.js';
import { ADMIN, closeTestApp, createTestApp, type TestContext } from './helpers/test-app.js';

// Nothing listens on this port: the API must start and degrade, not crash.
let ctx: TestContext;

beforeAll(async () => {
  ctx = await createTestApp({ VALKEY_URL: 'redis://localhost:6399' });
});
afterAll(async () => {
  await closeTestApp(ctx);
});

describe('when Valkey is down', () => {
  it('health reports it', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/api/health' });
    expect(res.json()).toMatchObject({ status: 'ok', valkey: 'down' });
  });

  it('sign-in fails with a clear 503 instead of a crash', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: ADMIN.email, password: ADMIN.password },
    });
    expect(res.statusCode).toBe(503);
    expect(res.json().code).toBe('AUTH_STORE_UNAVAILABLE');
  });

  it('existing access tokens keep working (verification does not need Valkey)', async () => {
    const user = await ctx.app.get(UsersService).findByEmail(ADMIN.email);
    const token = await ctx.app.get(AuthService).signAccess(user!);
    const res = await ctx.app.inject({ method: 'GET', url: '/api/auth/me', cookies: { aj_access: token } });
    expect(res.statusCode).toBe(200);
  });
});
