import { ADMIN, closeTestApp, cookiesOf, createTestApp, type TestContext } from './helpers/test-app.js';

let ctx: TestContext;
let admin: Record<string, string>;
let analyst: Record<string, string>;

const call = (cookies: Record<string, string>, method: 'GET' | 'PATCH', payload?: object) => ctx.app.inject({ method, url: '/api/me/prefs', cookies, payload });
const MIN = 60_000;
const ago = (mins: number) => new Date(Date.now() - mins * MIN).toISOString();

beforeAll(async () => {
  ctx = await createTestApp();
  const login = async (email: string, password: string) => cookiesOf(await ctx.app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password } }));
  admin = await login(ADMIN.email, ADMIN.password);
  await ctx.app.inject({ method: 'POST', url: '/api/users', cookies: admin, payload: { email: 'ana@example.com', name: 'Ana Lyst', password: 'analyst-password-1', role: 'analyst' } });
  analyst = await login('ana@example.com', 'analyst-password-1');
});
afterAll(() => closeTestApp(ctx));

describe('prefs defaults', () => {
  it('start with an empty watchlist and no Home visits', async () => {
    expect((await call(analyst, 'GET')).json()).toMatchObject({ watchlist: [], homeWatchlistOnly: false, lastSeen: { home: null, homePrev: null } });
  });
});

describe('lastSeen.home', () => {
  it('keeps the previous visit to compare against; opens within 30 minutes are one visit', async () => {
    const sent = ago(120);
    const first = (await call(admin, 'PATCH', { lastSeen: { home: sent } })).json();
    expect(first.lastSeen).toEqual({ home: sent, homePrev: null });

    // Two hours later: the first visit becomes the previous one.
    const second = (await call(admin, 'PATCH', { lastSeen: { home: ago(10) } })).json();
    expect(second.lastSeen.homePrev).toBe(first.lastSeen.home);
    expect(Date.parse(second.lastSeen.home)).toBeGreaterThan(Date.parse(first.lastSeen.home));

    // Ten minutes later (a reload, back from an asset): same visit, the previous one stays.
    const third = (await call(admin, 'PATCH', { lastSeen: { home: new Date().toISOString() } })).json();
    expect(third.lastSeen.homePrev).toBe(first.lastSeen.home);
    expect(Date.parse(third.lastSeen.home)).toBeGreaterThan(Date.parse(second.lastSeen.home));
  });

  it('caps a future client time at the server clock and is per user', async () => {
    const before = Date.now();
    const out = (await call(analyst, 'PATCH', { lastSeen: { home: '2099-01-01T00:00:00Z' } })).json();
    expect(Date.parse(out.lastSeen.home)).toBeGreaterThanOrEqual(before - 1000);
    expect(Date.parse(out.lastSeen.home)).toBeLessThanOrEqual(Date.now());
    expect((await call(admin, 'GET')).json().lastSeen.home).not.toBe(out.lastSeen.home);
  });

  it('rejects a non-date', async () => {
    expect((await call(admin, 'PATCH', { lastSeen: { home: 'yesterday' } })).statusCode).toBe(400);
  });
});

describe('watchlist', () => {
  it('replaces the list (deduplicated), per user, and remembers the Home chip', async () => {
    expect((await call(admin, 'PATCH', { watchlist: ['trep', 'sota', 'trep'], homeWatchlistOnly: true })).json()).toMatchObject({ watchlist: ['trep', 'sota'], homeWatchlistOnly: true });
    expect((await call(admin, 'PATCH', { watchlist: ['sota'] })).json()).toMatchObject({ watchlist: ['sota'], homeWatchlistOnly: true });
    expect((await call(analyst, 'GET')).json().watchlist).toEqual([]);
    // Other prefs are untouched by a watchlist write.
    expect((await call(admin, 'GET')).json()).toMatchObject({ journeyView: 'h', notify: { highEvents: true } });
  });

  it('rejects non-string ids and oversized lists', async () => {
    expect((await call(admin, 'PATCH', { watchlist: [1] })).statusCode).toBe(400);
    expect((await call(admin, 'PATCH', { watchlist: Array.from({ length: 501 }, (_, i) => `a${i}`) })).statusCode).toBe(400);
  });
});
