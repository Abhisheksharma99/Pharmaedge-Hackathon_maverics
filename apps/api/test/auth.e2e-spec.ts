import { JwtService } from '@nestjs/jwt';
import { ADMIN, closeTestApp, cookiesOf, createTestApp, type TestContext } from './helpers/test-app.js';

let ctx: TestContext;
// Logins are rate-limited (5/min per IP+email), so admin signs in once and
// scenarios needing fresh sessions use their own users.
let admin: Record<string, string>;
let userCounter = 0;

beforeAll(async () => {
  ctx = await createTestApp();
  admin = cookiesOf(await login(ADMIN.email, ADMIN.password));
});
afterAll(async () => {
  await closeTestApp(ctx);
});

const inject = (opts: Parameters<TestContext['app']['inject']>[0]) => ctx.app.inject(opts as any);

async function login(email: string, password: string) {
  return inject({ method: 'POST', url: '/api/auth/login', payload: { email, password } });
}

const USER_PASSWORD = 'analyst-password-1';

async function createUser(email = `user${++userCounter}@example.com`, role = 'analyst') {
  const res = await inject({
    method: 'POST',
    url: '/api/users',
    cookies: admin,
    payload: { email, name: 'Analyst', password: USER_PASSWORD, role },
  });
  expect(res.statusCode).toBe(201);
  return res.json() as { id: string; email: string };
}

/** A new user with a fresh session (its own rate-limit budget). */
async function newSession() {
  const user = await createUser();
  const res = await login(user.email, USER_PASSWORD);
  expect(res.statusCode).toBe(200);
  return { user, cookies: cookiesOf(res) };
}

describe('health', () => {
  it('is public and reports dependencies', async () => {
    const res = await inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok', mongo: 'up', valkey: 'up' });
  });
});

describe('login', () => {
  it('sets httpOnly session cookies and never returns the password hash', async () => {
    const user = await createUser('padded@example.com');
    // Emails are matched case-insensitively and pasted whitespace is ignored.
    const res = await login(`  ${user.email.toUpperCase()} `, USER_PASSWORD);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.user).toMatchObject({ email: user.email, role: 'analyst', active: true });
    expect(JSON.stringify(body)).not.toContain('passwordHash');

    const access = res.cookies.find((c) => c.name === 'aj_access');
    const refresh = res.cookies.find((c) => c.name === 'aj_refresh');
    expect(access).toMatchObject({ httpOnly: true, path: '/api', sameSite: 'Strict' });
    expect(refresh).toMatchObject({ httpOnly: true, path: '/api/auth', sameSite: 'Strict' });
  });

  it('gives the same answer for a wrong password and an unknown email', async () => {
    const wrongPassword = await login(ADMIN.email, 'not-the-password');
    const unknownEmail = await login('nobody@example.com', 'whatever-password');
    expect(wrongPassword.statusCode).toBe(401);
    expect(unknownEmail.statusCode).toBe(401);
    expect(wrongPassword.json()).toEqual(unknownEmail.json());
    expect(wrongPassword.json()).toEqual({
      statusCode: 401,
      code: 'INVALID_CREDENTIALS',
      message: 'Invalid email or password',
    });
  });

  it('rejects malformed input with VALIDATION_FAILED', async () => {
    const res = await inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'not-an-email' } });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('VALIDATION_FAILED');
  });

  it('rate-limits repeated attempts for the same email', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) statuses.push((await login('throttled@example.com', 'wrong-password')).statusCode);
    expect(statuses).toEqual([401, 401, 401, 401, 401, 429]);
    // A different email from the same IP is unaffected.
    expect((await login('someone-else@example.com', 'wrong-password')).statusCode).toBe(401);
  });
});

describe('protected routes', () => {
  it('require a session', async () => {
    const res = await inject({ method: 'GET', url: '/api/auth/me' });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ statusCode: 401, code: 'UNAUTHENTICATED', message: 'Sign in required' });
  });

  it('accept a valid access token', async () => {
    const res = await inject({ method: 'GET', url: '/api/auth/me', cookies: { aj_access: admin.aj_access } });
    expect(res.statusCode).toBe(200);
    expect(res.json().user.email).toBe(ADMIN.email);
  });

  it('reject tampered, expired and forged tokens', async () => {
    const tampered = admin.aj_access.slice(0, -2) + (admin.aj_access.endsWith('A') ? 'BB' : 'AA');
    const expired = await new JwtService({ secret: process.env.JWT_SECRET }).signAsync({
      sub: 'x',
      email: ADMIN.email,
      name: 'x',
      role: 'admin',
      exp: Math.floor(Date.now() / 1000) - 10,
    });
    const forged = await new JwtService({ secret: 'a-different-secret-that-is-32-chars-long!' }).signAsync({
      sub: 'x',
      email: ADMIN.email,
      name: 'x',
      role: 'admin',
    });
    for (const token of [tampered, expired, forged]) {
      const res = await inject({ method: 'GET', url: '/api/auth/me', cookies: { aj_access: token } });
      expect(res.statusCode).toBe(401);
      expect(res.json().code).toBe('TOKEN_INVALID');
    }
  });
});

describe('refresh', () => {
  it('rotates the refresh token', async () => {
    const first = (await newSession()).cookies;
    const res = await inject({ method: 'POST', url: '/api/auth/refresh', cookies: { aj_refresh: first.aj_refresh } });
    expect(res.statusCode).toBe(200);
    const second = cookiesOf(res);
    expect(second.aj_refresh).toBeTruthy();
    expect(second.aj_refresh).not.toBe(first.aj_refresh);
    expect(second.aj_access).toBeTruthy();
  });

  it('revokes the whole session when an old refresh token is replayed', async () => {
    const first = (await newSession()).cookies;
    const rotation = await inject({ method: 'POST', url: '/api/auth/refresh', cookies: { aj_refresh: first.aj_refresh } });
    expect(rotation.statusCode).toBe(200);
    const rotated = cookiesOf(rotation);
    const replay = await inject({ method: 'POST', url: '/api/auth/refresh', cookies: { aj_refresh: first.aj_refresh } });
    expect(replay.statusCode).toBe(401);
    expect(replay.json().code).toBe('REFRESH_REUSED');
    // The legitimate newer token from the same session is now dead too.
    const after = await inject({ method: 'POST', url: '/api/auth/refresh', cookies: { aj_refresh: rotated.aj_refresh } });
    expect(after.statusCode).toBe(401);
  });

  it('fails without a refresh cookie and after logout', async () => {
    expect((await inject({ method: 'POST', url: '/api/auth/refresh' })).statusCode).toBe(401);
    const session = (await newSession()).cookies;
    const out = await inject({ method: 'POST', url: '/api/auth/logout', cookies: { aj_refresh: session.aj_refresh } });
    expect(out.statusCode).toBe(204);
    const res = await inject({ method: 'POST', url: '/api/auth/refresh', cookies: { aj_refresh: session.aj_refresh } });
    expect(res.statusCode).toBe(401);
  });
});

describe('users (admin)', () => {
  it('are admin-only', async () => {
    const { user, cookies: analyst } = await newSession();
    const forbidden = await inject({ method: 'GET', url: '/api/users', cookies: analyst });
    expect(forbidden.statusCode).toBe(403);
    expect(forbidden.json().code).toBe('FORBIDDEN');
    const ok = await inject({ method: 'GET', url: '/api/users', cookies: admin });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().map((u: { email: string }) => u.email)).toContain(user.email);
  });

  it('treat emails case-insensitively for uniqueness', async () => {
    await createUser('dupe@example.com');
    const res = await inject({
      method: 'POST',
      url: '/api/users',
      cookies: admin,
      payload: { email: 'DUPE@Example.com', name: 'Dupe', password: 'analyst-password-1', role: 'analyst' },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('USER_EXISTS');
  });

  it('reject weak passwords and unknown fields', async () => {
    const weak = await inject({
      method: 'POST',
      url: '/api/users',
      cookies: admin,
      payload: { email: 'weak@example.com', name: 'Weak', password: 'short', role: 'analyst' },
    });
    expect(weak.statusCode).toBe(400);
    const extra = await inject({
      method: 'POST',
      url: '/api/users',
      cookies: admin,
      payload: { email: 'extra@example.com', name: 'X', password: 'analyst-password-1', role: 'analyst', isAdmin: true },
    });
    expect(extra.statusCode).toBe(400);
  });

  it('stop a deactivated user from refreshing or signing in', async () => {
    const { user, cookies: session } = await newSession();
    const deactivate = await inject({
      method: 'PATCH',
      url: `/api/users/${user.id}`,
      cookies: admin,
      payload: { active: false },
    });
    expect(deactivate.statusCode).toBe(200);
    const refresh = await inject({ method: 'POST', url: '/api/auth/refresh', cookies: { aj_refresh: session.aj_refresh } });
    expect(refresh.statusCode).toBe(401);
    expect(refresh.json().code).toBe('USER_INACTIVE');
    expect((await login(user.email, USER_PASSWORD)).statusCode).toBe(401);
  });

  it('do not let an admin lock themselves out', async () => {
    const me = (await inject({ method: 'GET', url: '/api/auth/me', cookies: admin })).json().user;
    const res = await inject({ method: 'PATCH', url: `/api/users/${me.id}`, cookies: admin, payload: { active: false } });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('CANNOT_MODIFY_SELF');
  });

  it('return 404 for unknown or malformed ids', async () => {
    for (const id of ['000000000000000000000000', 'not-an-id']) {
      const res = await inject({ method: 'PATCH', url: `/api/users/${id}`, cookies: admin, payload: { role: 'admin' } });
      expect(res.statusCode).toBe(404);
    }
  });
});
