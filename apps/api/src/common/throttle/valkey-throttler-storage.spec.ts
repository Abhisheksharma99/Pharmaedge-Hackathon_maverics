import { ValkeyThrottlerStorage } from './valkey-throttler-storage.js';

/** Just the commands the storage uses, with TTLs counted down by `advance`. */
function fakeValkey(opts: { up?: boolean; fail?: boolean } = {}) {
  const store = new Map<string, { n: number; ttl: number }>();
  const state = { up: opts.up ?? true, fail: opts.fail ?? false };
  const guard = () => {
    if (state.fail) throw new Error('boom');
  };
  const client = {
    incr: async (k: string) => {
      guard();
      const e = store.get(k) ?? { n: 0, ttl: -1 };
      e.n++;
      store.set(k, e);
      return e.n;
    },
    pttl: async (k: string) => store.get(k)!.ttl,
    pexpire: async (k: string, ms: number) => {
      store.get(k)!.ttl = ms;
    },
  };
  return {
    store,
    state,
    advance: (ms: number) => {
      for (const [k, e] of store) if (e.ttl >= 0 && (e.ttl -= ms) <= 0) store.delete(k);
    },
    valkey: { client: client as never, isAvailable: () => state.up, key: (...p: string[]) => `t:${p.join(':')}` },
  };
}

describe('ValkeyThrottlerStorage', () => {
  it('counts hits in Valkey, blocks past the limit and starts a new window after the ttl', async () => {
    const f = fakeValkey();
    const s = new ValkeyThrottlerStorage(f.valkey);
    const hit = () => s.increment('u1', 60_000, 2, 0, 'ai_minute');
    expect(await hit()).toEqual({ totalHits: 1, timeToExpire: 60, isBlocked: false, timeToBlockExpire: 0 });
    expect((await hit()).isBlocked).toBe(false);
    expect(await hit()).toEqual({ totalHits: 3, timeToExpire: 60, isBlocked: true, timeToBlockExpire: 60 });
    expect([...f.store.keys()]).toEqual(['t:throttle:ai_minute:u1']);
    f.advance(60_000);
    expect(await hit()).toMatchObject({ totalHits: 1, isBlocked: false });
  });

  it('keeps separate counters per key and limiter, and shares them between instances (processes)', async () => {
    const f = fakeValkey();
    const a = new ValkeyThrottlerStorage(f.valkey);
    const b = new ValkeyThrottlerStorage(f.valkey);
    await a.increment('u1', 60_000, 1, 0, 'ai_minute');
    expect((await b.increment('u1', 60_000, 1, 0, 'ai_minute')).isBlocked).toBe(true);
    expect((await b.increment('u2', 60_000, 1, 0, 'ai_minute')).isBlocked).toBe(false);
    expect((await b.increment('u1', 3_600_000, 1, 0, 'ai_hour')).isBlocked).toBe(false);
  });

  it('repairs a counter that lost its expiry', async () => {
    const f = fakeValkey();
    f.store.set('t:throttle:ai_minute:u1', { n: 5, ttl: -1 });
    const r = await new ValkeyThrottlerStorage(f.valkey).increment('u1', 60_000, 100, 0, 'ai_minute');
    expect(r.timeToExpire).toBe(60);
    expect(f.store.get('t:throttle:ai_minute:u1')!.ttl).toBe(60_000);
  });

  it.each([['is not connected', { up: false }], ['errors', { fail: true }]])('falls back to in-memory counters when Valkey %s', async (_n, o) => {
    const f = fakeValkey(o);
    const s = new ValkeyThrottlerStorage(f.valkey);
    expect((await s.increment('u1', 60_000, 1, 0, 'ai_minute')).totalHits).toBe(1);
    expect((await s.increment('u1', 60_000, 1, 0, 'ai_minute')).isBlocked).toBe(true);
    expect(f.store.size).toBe(0);
    s.onApplicationShutdown();
  });
});
