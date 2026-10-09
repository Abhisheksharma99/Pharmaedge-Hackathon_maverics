import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Db } from 'mongodb';
import { MONGO_DB } from '../src/database/database.module.js';
import { ADMIN, closeTestApp, cookiesOf, createTestApp, type TestContext } from './helpers/test-app.js';

// Stub of the Python crawl service: records calls, replies per `mode`.
let mode: 'ok' | 'conflict' | 'unknown-step' | 'down' | 'drops-once' = 'ok';
const calls: { path: string; key: string | undefined; body: any }[] = [];
let stub: Server;

const readBody = (req: IncomingMessage) =>
  new Promise<string>((resolve) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => resolve(data));
  });

let ctx: TestContext;
let cookies: Record<string, string>;

beforeAll(async () => {
  stub = createServer(async (req, res) => {
    const body = JSON.parse((await readBody(req)) || '{}');
    calls.push({ path: req.url!, key: req.headers['x-service-key'] as string, body });
    if (mode === 'down') return req.socket.destroy();
    if (mode === 'drops-once') {
      mode = 'ok';
      return req.socket.destroy();
    }
    res.setHeader('content-type', 'application/json');
    if (mode === 'conflict') {
      res.statusCode = 409;
      return res.end(JSON.stringify({ detail: { code: 'JOB_ALREADY_RUNNING', message: 'A crawl is already running', job_id: 'j0' } }));
    }
    if (mode === 'unknown-step') {
      res.statusCode = 400;
      return res.end(JSON.stringify({ detail: { code: 'UNKNOWN_STEP', message: 'Unknown steps: bogus. Available: patents' } }));
    }
    res.statusCode = req.url!.endsWith('/cancel') ? 200 : 201;
    res.end(JSON.stringify({ id: 'j1', asset: body.asset_id ?? 'trep', status: req.url!.endsWith('/cancel') ? 'cancelled' : 'queued', steps: [] }));
  });
  await new Promise<void>((r) => stub.listen(0, '127.0.0.1', r));
  const port = (stub.address() as AddressInfo).port;
  ctx = await createTestApp({ CRAWLER_API_URL: `http://127.0.0.1:${port}` });
  cookies = cookiesOf(
    await ctx.app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: ADMIN.email, password: ADMIN.password } }),
  );
  const db = ctx.app.get<Db>(MONGO_DB);
  await db.collection('assets').insertOne({ _id: 'trep' as any, name: 'Treprostinil' });
  await db.collection('jobs').insertMany([
    { _id: 'old' as any, asset: 'trep', type: 'refresh', status: 'completed', steps: [], created_at: new Date('2026-01-01') },
    { _id: 'new' as any, asset: 'trep', type: 'refresh', status: 'running', steps: [{ name: 'regulatory', status: 'running' }], created_at: new Date('2026-02-01') },
  ]);
});
afterAll(async () => {
  await closeTestApp(ctx);
  stub.close();
});
beforeEach(() => {
  mode = 'ok';
  calls.length = 0;
});

const req = (method: 'GET' | 'POST', url: string, payload?: object) => ctx.app.inject({ method, url, cookies, payload });

describe('jobs', () => {
  it('starts a refresh through the crawl service with the service key and the requesting user', async () => {
    const res = await req('POST', '/api/assets/trep/refresh');
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ id: 'j1', status: 'queued' });
    expect(calls[0]).toMatchObject({
      path: '/jobs',
      key: 'test-service-key-0123456789',
      body: { asset_id: 'trep', type: 'refresh', requested_by: { name: ADMIN.name } },
    });
  });

  it('runs only the requested steps when given', async () => {
    const res = await req('POST', '/api/assets/trep/refresh', { steps: ['patents', 'journey'] });
    expect(res.statusCode).toBe(201);
    expect(calls[0].body).toMatchObject({ asset_id: 'trep', steps: ['patents', 'journey'] });
    expect(calls[0].body.steps).toHaveLength(2);
  });

  it('rejects malformed step lists before calling the crawl service', async () => {
    for (const steps of [[], ['Patents!'], 'patents', [42]]) {
      expect((await req('POST', '/api/assets/trep/refresh', { steps })).statusCode).toBe(400);
    }
    expect(calls).toHaveLength(0);
  });

  it('passes through an unknown step from the crawl service as 400', async () => {
    mode = 'unknown-step';
    const res = await req('POST', '/api/assets/trep/refresh', { steps: ['bogus'] });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ code: 'UNKNOWN_STEP', message: 'Unknown steps: bogus. Available: patents' });
  });

  it('passes through "already running" from the crawl service', async () => {
    mode = 'conflict';
    const res = await req('POST', '/api/assets/trep/refresh');
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ code: 'JOB_ALREADY_RUNNING' });
  });

  it('reports a clear 503 when the crawl service is down', async () => {
    mode = 'down';
    const res = await req('POST', '/api/assets/trep/refresh');
    expect(res.statusCode).toBe(503);
    expect(res.json().code).toBe('CRAWLER_UNAVAILABLE');
  });

  it('retries once when the connection to the crawl service drops', async () => {
    mode = 'drops-once';
    const res = await req('POST', '/api/assets/trep/refresh');
    expect(res.statusCode).toBe(201);
    expect(calls).toHaveLength(2);
  });

  it('lists jobs newest first with the asset name, and filters', async () => {
    const all = (await req('GET', '/api/jobs')).json();
    expect(all.map((j: { id: string }) => j.id)).toEqual(['new', 'old']);
    expect(all[0].assetName).toBe('Treprostinil');
    expect((await req('GET', '/api/jobs?status=running')).json().map((j: { id: string }) => j.id)).toEqual(['new']);
    expect((await req('GET', '/api/jobs?status=bogus')).statusCode).toBe(400);
  });

  it('gets one job, 404 for unknown', async () => {
    expect((await req('GET', '/api/jobs/new')).json()).toMatchObject({ id: 'new', status: 'running', assetName: 'Treprostinil' });
    expect((await req('GET', '/api/jobs/nope')).json().code).toBe('JOB_NOT_FOUND');
  });

  it('cancels through the crawl service', async () => {
    const res = await req('POST', '/api/jobs/new/cancel');
    expect(res.statusCode).toBe(200);
    expect(calls[0].path).toBe('/jobs/new/cancel');
  });

  it('requires a session', async () => {
    expect((await ctx.app.inject({ method: 'POST', url: '/api/assets/trep/refresh' })).statusCode).toBe(401);
  });
});
