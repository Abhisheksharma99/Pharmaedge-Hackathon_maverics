import Joi from 'joi';

/** gpt-6-luna reasoning levels (OpenAI model page, 2026-10-10). */
export type ReasoningEffort = 'none' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';
const EFFORTS = ['none', 'low', 'medium', 'high', 'xhigh', 'max'];

/** Environment variables the API needs, validated once at startup. */
export interface Env {
  NODE_ENV: 'development' | 'production' | 'test';
  PORT: number;
  MONGODB_URI: string;
  MONGODB_DB: string;
  /** Database of the shared corpora (drug master lookup), on the same cluster. */
  CORPUS_DB: string;
  VALKEY_URL: string;
  VALKEY_PREFIX: string;
  JWT_SECRET: string;
  ACCESS_TOKEN_TTL_SECONDS: number;
  REFRESH_TOKEN_TTL_DAYS: number;
  COOKIE_SECURE: boolean;
  ADMIN_EMAIL: string;
  ADMIN_PASSWORD: string;
  ADMIN_NAME: string;
  CRAWLER_API_URL: string;
  CRAWLER_SERVICE_KEY: string;
  /** Asset AI. Without a key the API runs; chat answers LLM_UNAVAILABLE. */
  OPENAI_API_KEY: string;
  OPENAI_BASE_URL?: string;
  LLM_CHAT_MODEL: string;
  LLM_CHAT_REASONING_EFFORT: ReasoningEffort;
  LLM_FOLLOWUP_MODEL: string;
  LLM_FOLLOWUP_REASONING_EFFORT: ReasoningEffort;
  LLM_EMBEDDING_MODEL: string;
  /** Reranking, HyDE and the evidence check in search_evidence. */
  LLM_RAG_MODEL: string;
  /** Retrieval stages after hybrid search, comma separated: rerank, judge, hyde (see evidence-search.ts). */
  RAG_STAGES: string;
  EMBEDDING_DIMENSIONS: number;
  /** Days Asset AI turn audits (chat_audit) are kept. */
  AUDIT_RETENTION_DAYS: number;
}

const schema = Joi.object<Env>({
  NODE_ENV: Joi.string().valid('development', 'production', 'test').default('development'),
  PORT: Joi.number().port().default(3000),
  MONGODB_URI: Joi.string().uri({ scheme: ['mongodb', 'mongodb+srv'] }).required(),
  MONGODB_DB: Joi.string().default('asset_journey'),
  CORPUS_DB: Joi.string().pattern(/^[A-Za-z0-9_-]{1,64}$/).default('pharmaedge'),
  VALKEY_URL: Joi.string().uri({ scheme: ['redis', 'rediss'] }).default('redis://localhost:6380'),
  VALKEY_PREFIX: Joi.string().default('aj:'),
  JWT_SECRET: Joi.string().min(32).required(),
  ACCESS_TOKEN_TTL_SECONDS: Joi.number().integer().min(60).default(900),
  REFRESH_TOKEN_TTL_DAYS: Joi.number().integer().min(1).default(7),
  // Secure cookies need HTTPS; default on in production only so local http works.
  COOKIE_SECURE: Joi.boolean().default(Joi.ref('$isProduction')),
  ADMIN_EMAIL: Joi.string().email().required(),
  ADMIN_PASSWORD: Joi.string().min(12).required(),
  ADMIN_NAME: Joi.string().default('Administrator'),
  CRAWLER_API_URL: Joi.string().uri({ scheme: ['http', 'https'] }).default('http://localhost:8100'),
  CRAWLER_SERVICE_KEY: Joi.string().min(16).required(),
  OPENAI_API_KEY: Joi.string().allow('').default(''),
  // Tests point this at a local stub of the OpenAI API.
  OPENAI_BASE_URL: Joi.string().uri({ scheme: ['http', 'https'] }),
  // gpt-6-luna everywhere (the crawler and the presentation subsystem use it too): $0.10 in / $0.50 out per 1M tokens.
  LLM_CHAT_MODEL: Joi.string().default('gpt-6-luna'),
  // gpt-6-luna takes function tools on Chat Completions only with reasoning off ('none').
  LLM_CHAT_REASONING_EFFORT: Joi.string().valid(...EFFORTS).default('none'),
  LLM_FOLLOWUP_MODEL: Joi.string().default('gpt-6-luna'),
  // Follow-up suggestions are a short structured list: no reasoning needed (the model's own default is 'medium').
  LLM_FOLLOWUP_REASONING_EFFORT: Joi.string().valid(...EFFORTS).default('none'),
  // Must match the crawler's index (record_chunks embeddings).
  LLM_EMBEDDING_MODEL: Joi.string().default('text-embedding-3-small'),
  LLM_RAG_MODEL: Joi.string().default('gpt-6-luna'),
  RAG_STAGES: Joi.string().pattern(/^((rerank|judge|hyde)(,(rerank|judge|hyde))*)?$/).allow('').default('rerank'),
  EMBEDDING_DIMENSIONS: Joi.number().integer().min(64).default(1536),
  AUDIT_RETENTION_DAYS: Joi.number().integer().min(1).max(3650).default(180),
});

/** `validate` hook for ConfigModule (its `validationSchema` expects a Standard Schema). */
export function validateEnv(raw: Record<string, unknown>): Env {
  const { error, value } = schema.validate(raw, {
    allowUnknown: true,
    abortEarly: false,
    context: { isProduction: raw.NODE_ENV === 'production' },
  });
  if (error) {
    throw new Error(`Invalid environment: ${error.details.map((d) => d.message).join('; ')}`);
  }
  return value;
}
