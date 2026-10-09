import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Db } from 'mongodb';
import { MONGO_DB } from '../src/database/database.module.js';
import { ADMIN, closeTestApp, cookiesOf, createTestApp, type TestContext } from './helpers/test-app.js';

// Stub of the OpenAI API: each streamed chat call pops the next scripted reply.
type Reply = { toolCalls: { name: string; args: object }[] } | { text: string } | { status: number };
let script: Reply[] = [];
const requests: any[] = [];
// Stub of the crawl service (resolve_asset).
let resolveStatus = 200;

let openai: Server;
let crawler: Server;
let ctx: TestContext;
let cookies: Record<string, string>;
let db: Db;

const readBody = (req: IncomingMessage) =>
  new Promise<string>((resolve) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => resolve(data));
  });

const chunk = (delta: object, extra: object = {}) =>
  `data: ${JSON.stringify({ id: 'c1', object: 'chat.completion.chunk', created: 0, model: 'stub-model', choices: [{ index: 0, delta, finish_reason: null }], ...extra })}\n\n`;

function startOpenAi() {
  return createServer(async (req, res) => {
    const body = JSON.parse((await readBody(req)) || '{}');
    requests.push(body);
    if (!body.stream) {
      // follow-up suggestions (structured output)
      res.setHeader('content-type', 'application/json');
      return res.end(JSON.stringify({
        id: 'f1', object: 'chat.completion', created: 0, model: 'stub-model',
        choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify({ questions: ['Next one?', 'Another?'] }) } }],
      }));
    }
    const reply = script.shift() ?? { text: 'Done.' };
    if ('status' in reply) {
      res.statusCode = reply.status;
      res.setHeader('content-type', 'application/json');
      return res.end(JSON.stringify({ error: { message: 'boom', type: 'server_error' } }));
    }
    res.setHeader('content-type', 'text/event-stream');
    if ('toolCalls' in reply) {
      reply.toolCalls.forEach((c, i) =>
        res.write(chunk({ tool_calls: [{ index: i, id: `call_${i}`, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.args) } }] })),
      );
    } else {
      for (const piece of reply.text.match(/.{1,8}/gs) ?? []) res.write(chunk({ content: piece }));
    }
    res.write(`data: ${JSON.stringify({ id: 'c1', object: 'chat.completion.chunk', created: 0, model: 'stub-model', choices: [], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } })}\n\n`);
    res.end('data: [DONE]\n\n');
  });
}

const listen = (s: Server) => new Promise<number>((r) => s.listen(0, '127.0.0.1', () => r((s.address() as AddressInfo).port)));

beforeAll(async () => {
  openai = startOpenAi();
  crawler = createServer(async (req, res) => {
    const body = JSON.parse((await readBody(req)) || '{}');
    res.setHeader('content-type', 'application/json');
    if (req.url === '/resolve') {
      res.statusCode = resolveStatus;
      return res.end(JSON.stringify(resolveStatus === 200
        ? { id: 'sotatercept', name: 'Sotatercept', aliases: ['Winrevair'], company: { name: 'Merck' }, tags: { indications: ['PAH'] }, exists: false, existing: null, plan_summary: 'FDA + EMA' }
        : { detail: { code: 'ASSET_NOT_RESOLVED', message: `Nothing for ${body.query}` } }));
    }
    res.statusCode = 404;
    res.end('{}');
  });
  const [openaiPort, crawlerPort] = await Promise.all([listen(openai), listen(crawler)]);
  ctx = await createTestApp({
    OPENAI_API_KEY: 'sk-test',
    OPENAI_BASE_URL: `http://127.0.0.1:${openaiPort}/v1`,
    CRAWLER_API_URL: `http://127.0.0.1:${crawlerPort}`,
  });
  cookies = cookiesOf(
    await ctx.app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: ADMIN.email, password: ADMIN.password } }),
  );
  db = ctx.app.get<Db>(MONGO_DB);
  await db.collection('assets').insertOne({
    _id: 'trep' as any, name: 'Treprostinil', aliases: ['Tyvaso'], company: { name: 'United Therapeutics' },
    tags: { indications: ['PAH'] }, kind: 'primary', status: 'ready', competitors: [],
  });
  await db.collection('trial_records').insertMany([
    { record_key: 'ctgov:NCT1', nct_id: 'NCT1', acronym: 'TETON', title: 'TETON phase 3', phases: ['PHASE3'], overall_status: 'RECRUITING', date: '2025-01-01', start_date: '2025-01-01', assets: ['trep'], url: 'https://clinicaltrials.gov/study/NCT1' },
    { record_key: 'ctgov:NCT2', nct_id: 'NCT2', title: 'INCREASE', phases: ['PHASE2'], overall_status: 'COMPLETED', date: '2017-01-01', assets: ['trep'] },
  ]);
});
afterAll(async () => {
  await closeTestApp(ctx);
  openai.close();
  crawler.close();
});
beforeEach(() => {
  script = [];
  requests.length = 0;
  resolveStatus = 200;
});

const req = (method: 'GET' | 'POST' | 'DELETE', url: string, payload?: object, as = cookies) =>
  ctx.app.inject({ method, url, cookies: as, payload });
const events = (body: string) => body.trim().split('\n').map((l) => JSON.parse(l));

async function newSession(assetId?: string) {
  return (await req('POST', '/api/chat/sessions', assetId ? { assetId } : {})).json().id as string;
}

describe('Asset AI chat', () => {
  it('runs tools, streams the answer and keeps only the citations it used', async () => {
    const id = await newSession('trep');
    script = [{ toolCalls: [{ name: 'get_trials', args: { asset_id: 'trep', status: 'active' } }] }, { text: 'TETON is recruiting [1].' }];
    const res = await req('POST', `/api/chat/sessions/${id}/turn`, { message: 'Which trials are active?' });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('application/x-ndjson');
    const evs = events(res.body);
    expect(evs.map((e) => e.type)).toEqual(['tool_call', 'tool_result', ...evs.filter((e) => e.type === 'token').map(() => 'token'), 'answer', 'done']);
    expect(evs[0]).toMatchObject({ name: 'get_trials', label: 'Reading clinical trials of trep' });
    expect(evs[1]).toMatchObject({ summary: '1 trial' });
    const answer = evs.find((e) => e.type === 'answer').message;
    expect(answer).toMatchObject({ role: 'assistant', content: 'TETON is recruiting [1].', followUps: ['Next one?', 'Another?'] });
    expect(answer.citations).toEqual([
      expect.objectContaining({ n: 1, assetId: 'trep', collection: 'trial_records', recordKey: 'ctgov:NCT1', tab: 'clinical', source: 'ClinicalTrials.gov', title: 'TETON: TETON phase 3' }),
    ]);

    // The tool result handed to the model carries the ref number; the page context names the asset.
    const second = requests.find((r, i) => i === 1);
    expect(second.messages[0].content).toContain('asset page of Treprostinil');
    expect(JSON.parse(second.messages.at(-1).content).trials[0]).toMatchObject({ ref: 1, nct_id: 'NCT1' });

    const stored = (await req('GET', `/api/chat/sessions/${id}/messages`)).json();
    expect(stored.map((m: any) => m.role)).toEqual(['user', 'assistant']);
    expect(stored[1].citations).toHaveLength(1);
    const sessions = (await req('GET', '/api/chat/sessions?asset=trep')).json();
    expect(sessions[0]).toMatchObject({ id, title: 'Which trials are active?', assetId: 'trep' });
  });

  it('shows an identity card when the user asks to add a drug', async () => {
    const id = await newSession();
    script = [{ toolCalls: [{ name: 'resolve_asset', args: { name: 'sotatercept' } }] }, { text: 'Found Sotatercept by Merck. Check the card and confirm.' }];
    const evs = events((await req('POST', `/api/chat/sessions/${id}/turn`, { message: 'Add sotatercept' })).body);
    expect(evs.find((e) => e.type === 'card').card).toMatchObject({ type: 'identity', identity: { id: 'sotatercept', name: 'Sotatercept' } });
    expect(evs.find((e) => e.type === 'answer').message.cards).toHaveLength(1);
  });

  it('tells the model when a drug cannot be resolved', async () => {
    const id = await newSession();
    resolveStatus = 404;
    script = [{ toolCalls: [{ name: 'resolve_asset', args: { name: 'xyzzy' } }] }, { text: 'I could not find it.' }];
    const evs = events((await req('POST', `/api/chat/sessions/${id}/turn`, { message: 'Add xyzzy' })).body);
    expect(evs.find((e) => e.type === 'tool_result')).toMatchObject({ summary: 'not found' });
    expect(JSON.parse(requests[1].messages.at(-1).content)).toMatchObject({ found: false });
  });

  it('caps tool calls per question at six', async () => {
    const id = await newSession('trep');
    const call = { name: 'get_trials', args: { asset_id: 'trep' } };
    script = [{ toolCalls: [call, call, call, call] }, { toolCalls: [call, call, call] }, { text: 'Enough.' }];
    const evs = events((await req('POST', `/api/chat/sessions/${id}/turn`, { message: 'Dig deep' })).body);
    expect(evs.filter((e) => e.type === 'tool_result').map((e) => e.summary).filter((s) => s === 'skipped')).toHaveLength(1);
    expect(requests[2].tool_choice).toBe('none');
  });

  it('streams an error event when the model fails before answering', async () => {
    const id = await newSession();
    script = [{ status: 400 }];
    const evs = events((await req('POST', `/api/chat/sessions/${id}/turn`, { message: 'Hello' })).body);
    expect(evs.map((e) => e.type)).toEqual(['error', 'done']);
    expect(evs[0]).toMatchObject({ code: 'LLM_UNAVAILABLE' });
  });

  it("keeps sessions private to their owner", async () => {
    const id = await newSession();
    await req('POST', '/api/users', { email: 'analyst@example.com', name: 'Ana Lyst', password: 'analyst-password-1', role: 'analyst' });
    const other = cookiesOf(
      await ctx.app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'analyst@example.com', password: 'analyst-password-1' } }),
    );
    expect((await req('GET', `/api/chat/sessions/${id}/messages`, undefined, other)).statusCode).toBe(404);
    expect((await req('POST', `/api/chat/sessions/${id}/turn`, { message: 'hi' }, other)).json()).toMatchObject({ code: 'SESSION_NOT_FOUND' });
    expect((await req('GET', '/api/chat/sessions', undefined, other)).json()).toEqual([]);
    expect((await req('DELETE', `/api/chat/sessions/${id}`)).statusCode).toBe(204);
    expect((await req('GET', `/api/chat/sessions/${id}/messages`)).statusCode).toBe(404);
  });

  it('rejects a session for an unknown asset and an empty question', async () => {
    expect((await req('POST', '/api/chat/sessions', { assetId: 'nope' })).json()).toMatchObject({ code: 'ASSET_NOT_FOUND' });
    const id = await newSession();
    expect((await req('POST', `/api/chat/sessions/${id}/turn`, { message: '   ' })).statusCode).toBe(400);
  });
});
