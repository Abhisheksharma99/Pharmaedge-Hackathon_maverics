import Joi from 'joi';

/** Environment variables the API needs, validated once at startup. */
export interface Env {
  NODE_ENV: 'development' | 'production' | 'test';
  PORT: number;
  MONGODB_URI: string;
  MONGODB_DB: string;
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
  LLM_CHAT_REASONING_EFFORT: 'none' | 'minimal' | 'low' | 'medium' | 'high';
  LLM_FOLLOWUP_MODEL: string;
  LLM_EMBEDDING_MODEL: string;
  EMBEDDING_DIMENSIONS: number;
  /** Real web search (allow-listed domains) for notes/find and analytics. Off by default. */
  ANALYTICS_WEB_SEARCH: boolean;
  /** Per-user limits on the costly AI routes (analytics build, notes find). */
  AI_RATE_PER_MINUTE: number;
  AI_RATE_PER_HOUR: number;
}

const schema = Joi.object<Env>({
  NODE_ENV: Joi.string().valid('development', 'production', 'test').default('development'),
  PORT: Joi.number().port().default(3000),
  MONGODB_URI: Joi.string().uri({ scheme: ['mongodb', 'mongodb+srv'] }).required(),
  MONGODB_DB: Joi.string().default('asset_journey'),
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
  LLM_CHAT_MODEL: Joi.string().default('gpt-5.4-mini'),
  // gpt-5.4 models accept function tools on Chat Completions only with reasoning off ('none').
  LLM_CHAT_REASONING_EFFORT: Joi.string().valid('none', 'minimal', 'low', 'medium', 'high').default('none'),
  LLM_FOLLOWUP_MODEL: Joi.string().default('gpt-5.4-nano'),
  // Must match the crawler's index (record_chunks embeddings).
  LLM_EMBEDDING_MODEL: Joi.string().default('text-embedding-3-small'),
  EMBEDDING_DIMENSIONS: Joi.number().integer().min(64).default(1536),
  ANALYTICS_WEB_SEARCH: Joi.boolean().truthy('1').falsy('0').default(false),
  AI_RATE_PER_MINUTE: Joi.number().integer().min(1).default(10),
  AI_RATE_PER_HOUR: Joi.number().integer().min(1).default(60),
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
