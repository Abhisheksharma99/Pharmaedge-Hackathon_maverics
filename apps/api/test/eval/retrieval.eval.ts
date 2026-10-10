/**
 * Retrieval evaluation on the golden set (test/eval/golden.json, built by build_golden.py from real data).
 *
 *   EVAL_MONGODB_URI=... EVAL_OPENAI_API_KEY=... [EVAL_MODES=legacy,vector,text,app_fusion,fusion] \
 *     npx vitest run --config ./vitest.config.eval.ts retrieval
 *
 * Not part of `npm test`: it needs a MongoDB with mongot (search + vector indexes over record_chunks) and makes
 * real embedding calls (one per question; ~$0.0001 for the whole set). Metrics per mode:
 *   hit@k       an expected record is among the k passages
 *   recall@k    share of the question's expected records among the k passages
 *   MRR         1 / rank of the first expected record
 *   precision@k share of the k passages that are relevant (match the question's `relevant` pattern)
 *   abstain     absent questions judged insufficient (correct) / answerable judged insufficient (false abstention)
 * `legacy` is the pre-change search_evidence (vector only, numCandidates 200, 2 passages per record).
 * Stages after retrieval are added with "+": fusion+rerank, hyde+fusion... (order free), fusion+rerank+judge.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { MongoClient, type Db, type Document } from 'mongodb';
import OpenAI from 'openai';
import { describe, it } from 'vitest';
import { EvidenceSearch, parseStages, type EvidenceHit, type Strategy } from '../../src/chat/evidence-search.js';

interface Golden {
  id: string; category: string; question: string; scope: string[]; expect: 'answer' | 'abstain' | 'refuse';
  expected: string[]; relevant: string | null; facts: string[];
}

const K = 8;
const URI = process.env.EVAL_MONGODB_URI;
const golden = JSON.parse(readFileSync(new URL('./golden.json', import.meta.url), 'utf8')) as Golden[];

async function legacy(db: Db, vector: number[], scope: string[], limit: number): Promise<EvidenceHit[]> {
  const hits = await db.collection('record_chunks').aggregate([
    { $vectorSearch: { index: 'record_chunks_vector', path: 'embedding', queryVector: vector, numCandidates: 200, limit: limit * 3, filter: { assets: { $in: scope } } } },
    { $project: { embedding: 0, score: { $meta: 'vectorSearchScore' } } },
  ]).toArray();
  const per = new Map<string, number>();
  return hits.filter((h) => {
    const key = `${h.collection}|${h.record_key}`;
    per.set(key, (per.get(key) ?? 0) + 1);
    return per.get(key)! <= 2;
  }).slice(0, limit).map((d: Document) => ({
    collection: d.collection, record_key: d.record_key, chunk: d.chunk, text: d.text, title: d.title, date: d.date, url: d.url,
    record_type: d.record_type, assets: d.assets, score: d.score, via: ['vector'],
  }));
}

describe.skipIf(!URI)('retrieval eval', () => {
  it('scores every mode on the golden set', async () => {
    const client = new MongoClient(URI!);
    const db = client.db(process.env.EVAL_MONGODB_DB ?? 'asset_journey');
    const openai = new OpenAI({ apiKey: process.env.EVAL_OPENAI_API_KEY });
    const vectors = new Map<string, number[]>();
    const embed = async (q: string) => {
      if (!vectors.has(q)) {
        const r = await openai.embeddings.create({ model: 'text-embedding-3-small', input: q, dimensions: 1536 });
        vectors.set(q, r.data[0]!.embedding);
      }
      return vectors.get(q)!;
    };
    const memory = new Map<string, unknown>();
    const cache = { getJson: async (k: string) => (memory.get(k) as never) ?? null, setJson: async (k: string, v: unknown) => void memory.set(k, v) };
    const config = { get: (k: string) => ({ LLM_EMBEDDING_MODEL: 'text-embedding-3-small', EMBEDDING_DIMENSIONS: 1536, RAG_STAGES: '' } as Record<string, unknown>)[k] };
    const usage = { prompt: 0, completion: 0 };
    // The retrieval model of the app (LLM_RAG_MODEL default), for rerank / hyde / judge.
    const structured = async (system: string, user: string, name: string, schema: Record<string, unknown>, max = 800) => {
      const r = await openai.chat.completions.create({
        model: process.env.EVAL_RAG_MODEL ?? 'gpt-6-luna', reasoning_effort: 'none', max_completion_tokens: max,
        messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
        response_format: { type: 'json_schema', json_schema: { name, strict: true, schema } },
      });
      usage.prompt += r.usage?.prompt_tokens ?? 0;
      usage.completion += r.usage?.completion_tokens ?? 0;
      return JSON.parse(r.choices[0]?.message.content ?? '{}');
    };
    const search = new EvidenceSearch(db, { embed, structured } as never, cache as never, config as never);

    const modes = (process.env.EVAL_MODES ?? 'legacy,vector,text,app_fusion,fusion').split(',');
    const usageAt = () => ({ ...usage });
    const rows: Record<string, unknown>[] = [];
    const per: Record<string, unknown>[] = [];
    for (const mode of modes) {
      const before = usageAt();
      const acc = { n: 0, hit: 0, recall: 0, mrr: 0, prec: 0, absentN: 0, absentOk: 0, falseAbstain: 0, ms: [] as number[] };
      const byCat: Record<string, { n: number; hit: number; recall: number }> = {};
      // Questions run EVAL_CONCURRENCY at a time (model stages make each one a few seconds).
      const questions = golden.filter((x) => x.expect !== 'refuse' && x.category !== 'injection');
      const runOne = async (g: Golden) => {
        const t0 = performance.now();
        let hits: EvidenceHit[];
        let sufficient = true;
        if (mode === 'legacy') hits = await legacy(db, await embed(g.question), g.scope, K);
        else {
          // "fusion@0.4:0.6" = fusion with vector:text weights 0.4:0.6 for every question (weight sweep)
          const [spec, w] = mode.split('@');
          const parts = spec!.split('+');
          const m = parts.find((x) => ['fusion', 'app_fusion', 'vector', 'text'].includes(x)) ?? 'fusion';
          const stages = parseStages(parts.filter((x) => x !== m).join(','));
          const weights = w ? { vector: Number(w.split(':')[0]), text: Number(w.split(':')[1]) } : undefined;
          const assetNames = (await db.collection('assets').find({ _id: { $in: g.scope as never[] } }, { projection: { name: 1, aliases: 1 } }).toArray())
            .flatMap((a) => [a.name as string, ...((a.aliases as string[]) ?? [])]);
          const r = await search.search({ query: g.question, assetIds: g.scope, limit: K, weights, assetNames, stages }, m as Strategy);
          hits = r.hits;
          sufficient = r.sufficient;
        }
        acc.ms.push(performance.now() - t0);
        if (g.expect === 'abstain') {
          acc.absentN++;
          if (!sufficient || !hits.length) acc.absentOk++;
          return;
        }
        const keys = hits.map((h) => `${h.collection}|${h.record_key}`);
        const found = g.expected.filter((e) => keys.includes(e));
        const firstRank = keys.findIndex((k) => g.expected.includes(k));
        const rx = g.relevant ? new RegExp(g.relevant, 'i') : null;
        const relevant = rx ? hits.filter((h) => rx.test(`${h.title ?? ''} ${h.text}`)).length : 0;
        acc.n++;
        acc.hit += found.length ? 1 : 0;
        acc.recall += Math.min(found.length / Math.min(g.expected.length, K), 1);
        acc.mrr += firstRank >= 0 ? 1 / (firstRank + 1) : 0;
        acc.prec += hits.length ? relevant / hits.length : 0;
        if (!sufficient) acc.falseAbstain++;
        const c = (byCat[g.category] ??= { n: 0, hit: 0, recall: 0 });
        c.n++;
        c.hit += found.length ? 1 : 0;
        c.recall += Math.min(found.length / Math.min(g.expected.length, K), 1);
        per.push({ mode, id: g.id, category: g.category, hit: found.length > 0, rank: firstRank + 1, top: keys.slice(0, 3) });
      };
      const width = Number(process.env.EVAL_CONCURRENCY ?? 6);
      for (let i = 0; i < questions.length; i += width) await Promise.all(questions.slice(i, i + width).map(runOne));
      const ms = acc.ms.sort((a, b) => a - b);
      rows.push({
        mode, questions: acc.n, [`hit@${K}`]: +(acc.hit / acc.n).toFixed(3), [`recall@${K}`]: +(acc.recall / acc.n).toFixed(3),
        MRR: +(acc.mrr / acc.n).toFixed(3), [`precision@${K}`]: +(acc.prec / acc.n).toFixed(3),
        absent_abstained: `${acc.absentOk}/${acc.absentN}`, false_abstain: `${acc.falseAbstain}/${acc.n}`,
        p50_ms: Math.round(ms[Math.floor(ms.length / 2)]!), p95_ms: Math.round(ms[Math.floor(ms.length * 0.95)]!),
        llm_tokens: usage.prompt - before.prompt + usage.completion - before.completion,
        by_category: Object.fromEntries(Object.entries(byCat).map(([k, v]) => [k, `${v.hit}/${v.n}`])),
      });
      console.log('MODE', JSON.stringify(rows.at(-1))); // as each mode finishes: a long run still reports what it measured
    }
    console.table(rows.map(({ by_category: _, ...r }) => r));
    for (const r of rows) console.log(r.mode, JSON.stringify(r.by_category));
    const dir = process.env.EVAL_OUT_DIR;
    if (dir) {
      mkdirSync(dir, { recursive: true });
      writeFileSync(`${dir}/retrieval-${Date.now()}.json`, JSON.stringify({ rows, per }, null, 1));
    }
    await client.close();
  }, Number(process.env.EVAL_TIMEOUT_MS ?? 3_600_000));
});
