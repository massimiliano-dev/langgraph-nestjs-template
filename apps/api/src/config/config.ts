import { z } from 'zod';
import { DEFAULT_PRICING, type PricingTable, PricingTableSchema } from './pricing.js';

/**
 * Configuration is read once at boot from environment variables, validated with zod, and frozen.
 * Any problem stops the process with the list of offending variable NAMES (never their values).
 * Secrets come only from the environment: there are no config files with credentials.
 */

const csv = (value: string | undefined) =>
  (value ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

const bool = z.stringbool({ truthy: ['true', '1', 'yes'], falsy: ['false', '0', 'no', ''] });
const int = (min: number, max: number) => z.coerce.number().int().min(min).max(max);
/** A secret must be long enough to resist guessing. Generate with: openssl rand -hex 32 */
const secret = (min = 32) =>
  z
    .string()
    .min(min, `must be at least ${min} characters`)
    .refine((v) => !/^__.*__$/.test(v), 'still the placeholder from .env.example: generate a real value');
const httpsUrl = z.url({ protocol: /^https$/ });
const isBareOrigin = (v: string) => {
  try {
    return new URL(v).origin === v;
  } catch {
    return false;
  }
};
// Zod runs refinements even after the URL check failed, hence the defensive parser above.
const origin = z.url({ protocol: /^https?$/ }).refine(isBareOrigin, {
  message: 'must be a bare origin like https://app.example.com (no path, no trailing slash)',
});

/** PostgreSQL identifiers are interpolated into DDL, so only a strict subset is accepted. */
export const SQL_IDENTIFIER = /^[a-z_][a-z0-9_]{0,62}$/;

const LlmBase = z.object({
  LLM_TEMPERATURE: z.coerce.number().min(0).max(2).default(0),
  LLM_MAX_OUTPUT_TOKENS: int(16, 32_768).default(1024),
  LLM_TIMEOUT_MS: int(1_000, 600_000).default(60_000),
  LLM_MAX_RETRIES: int(0, 10).default(2),
  LLM_PRICING_JSON: z.string().optional(),
});

const OpenAiEnv = LlmBase.extend({
  LLM_PROVIDER: z.literal('openai'),
  OPENAI_API_KEY: secret(20),
  OPENAI_MODEL: z.string().min(1).default('gpt-4.1-mini'),
  OPENAI_BASE_URL: httpsUrl.optional(),
});

const AzureEnv = LlmBase.extend({
  LLM_PROVIDER: z.literal('azure-openai'),
  AZURE_OPENAI_API_KEY: secret(20),
  AZURE_OPENAI_ENDPOINT: httpsUrl,
  AZURE_OPENAI_DEPLOYMENT: z.string().min(1),
  AZURE_OPENAI_API_VERSION: z.string().min(1).default('2024-10-21'),
  /** Model behind the deployment, used for the price table and the `llm.model` span attribute. */
  AZURE_OPENAI_MODEL: z.string().min(1).optional(),
});

const LlmEnv = z.discriminatedUnion('LLM_PROVIDER', [OpenAiEnv, AzureEnv]);

const ApiKeyAuthEnv = z.object({
  AUTH_MODE: z.literal('api-key'),
  API_KEYS: z
    .string()
    .transform(csv)
    .pipe(
      z
        .array(
          secret().regex(/^[A-Za-z0-9._~+/=-]+$/, 'use only URL-safe characters (e.g. openssl rand -hex 32)'),
        )
        .min(1, 'at least one key is required'),
    ),
});

const JwtAuthEnv = z
  .object({
    AUTH_MODE: z.literal('jwt'),
    JWT_ISSUER: z.string().min(1),
    JWT_AUDIENCE: z.string().min(1),
    JWT_JWKS_URL: httpsUrl.optional(),
    JWT_SECRET: secret().optional(),
    JWT_ALGORITHMS: z.string().optional(),
    JWT_TENANT_CLAIM: z.string().min(1).default('tenant_id'),
  })
  .refine((v) => Boolean(v.JWT_JWKS_URL) !== Boolean(v.JWT_SECRET), {
    message: 'set exactly one of JWT_JWKS_URL or JWT_SECRET',
    path: ['JWT_JWKS_URL'],
  });

const AuthEnv = z.discriminatedUnion('AUTH_MODE', [ApiKeyAuthEnv, JwtAuthEnv]);

const CoreEnv = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('production'),
  HOST: z.string().default('0.0.0.0'),
  PORT: int(1, 65_535).default(3000),
  DATABASE_URL: z.string().regex(/^postgres(ql)?:\/\//, 'must be a postgresql:// URL'),
  DB_SCHEMA: z.string().regex(SQL_IDENTIFIER, 'must match ^[a-z_][a-z0-9_]{0,62}$').default('agent'),
  DB_POOL_MAX: int(1, 100).default(10),
  DB_AUTO_MIGRATE: bool.default(true),
  CORS_ORIGINS: z.string().optional().transform(csv).pipe(z.array(origin)),
  BODY_LIMIT: z
    .string()
    .regex(/^\d{1,4}kb$/, 'use a value like 16kb')
    .default('16kb'),
  MAX_MESSAGE_CHARS: int(1, 100_000).default(4000),
  AGENT_MAX_STEPS: int(2, 100).default(12),
  RATE_LIMIT_PER_MINUTE: int(1, 100_000).default(30),
  RATE_LIMIT_BURST: int(1, 100_000).default(10),
  TENANT_MONTHLY_TOKEN_BUDGET: int(1, Number.MAX_SAFE_INTEGER).default(1_000_000),
  SEND_EMAIL_ALLOWED_DOMAINS: z
    .string()
    .default('example.com')
    .transform(csv)
    .pipe(z.array(z.string().regex(/^[a-z0-9.-]+\.[a-z]{2,}$/i)).min(1)),
  OTEL_ENABLED: bool.default(false),
  OTEL_EXPORTER_OTLP_ENDPOINT: z.url({ protocol: /^https?$/ }).optional(),
  OTEL_SERVICE_NAME: z.string().min(1).default('langgraph-agent-api'),
  /** Off by default: prompts, completions and tool arguments may contain PII. */
  OTEL_CAPTURE_CONTENT: bool.default(false),
});

export type LlmConfig =
  | {
      provider: 'openai';
      apiKey: string;
      model: string;
      baseUrl?: string;
      temperature: number;
      maxOutputTokens: number;
      timeoutMs: number;
      maxRetries: number;
      pricing: PricingTable;
    }
  | {
      provider: 'azure-openai';
      apiKey: string;
      endpoint: string;
      deployment: string;
      apiVersion: string;
      model: string;
      temperature: number;
      maxOutputTokens: number;
      timeoutMs: number;
      maxRetries: number;
      pricing: PricingTable;
    };

export type AuthConfig =
  | { mode: 'api-key'; apiKeys: string[] }
  | {
      mode: 'jwt';
      issuer: string;
      audience: string;
      jwksUrl?: string;
      secret?: string;
      algorithms: string[];
      tenantClaim: string;
    };

export interface AppConfig {
  env: 'development' | 'test' | 'production';
  host: string;
  port: number;
  database: { url: string; schema: string; poolMax: number; autoMigrate: boolean };
  http: { corsOrigins: string[]; bodyLimit: string; maxMessageChars: number };
  auth: AuthConfig;
  llm: LlmConfig;
  agent: { maxSteps: number; emailAllowedDomains: string[] };
  limits: { ratePerMinute: number; burst: number; monthlyTokenBudget: number };
  otel: { enabled: boolean; endpoint?: string; serviceName: string; captureContent: boolean };
}

export class ConfigError extends Error {
  constructor(readonly issues: string[]) {
    super(`Invalid configuration:\n  - ${issues.join('\n  - ')}`);
    this.name = 'ConfigError';
  }
}

type Env = Record<string, string | undefined>;

/** Formats zod issues with the variable name only. Values are never echoed: they may be secrets. */
function issuesOf(error: z.ZodError): string[] {
  return error.issues.map((issue) => {
    const name = issue.path.length ? issue.path.join('.') : '(env)';
    return issue.code === 'invalid_type' && issue.input === undefined
      ? `${name}: required`
      : `${name}: ${issue.message}`;
  });
}

function parsePricing(raw: string | undefined, issues: string[]): PricingTable {
  if (!raw) return DEFAULT_PRICING;
  try {
    const parsed = PricingTableSchema.safeParse(JSON.parse(raw));
    if (parsed.success) return { ...DEFAULT_PRICING, ...parsed.data };
    issues.push(...issuesOf(parsed.error).map((i) => `LLM_PRICING_JSON ${i}`));
  } catch {
    issues.push('LLM_PRICING_JSON: must be valid JSON');
  }
  return DEFAULT_PRICING;
}

/** LLM settings only. Used on its own by the eval runner, which needs no database or auth settings. */
export function loadLlmConfig(env: Env = process.env): LlmConfig {
  const issues: string[] = [];
  const llm = parseLlm(env, issues);
  if (!llm) throw new ConfigError(issues);
  return llm;
}

function parseLlm(env: Env, issues: string[]): LlmConfig | undefined {
  const result = LlmEnv.safeParse({ ...env, LLM_PROVIDER: env.LLM_PROVIDER ?? 'openai' });
  if (!result.success) {
    issues.push(...issuesOf(result.error));
    return undefined;
  }
  const v = result.data;
  const pricing = parsePricing(v.LLM_PRICING_JSON, issues);
  const common = {
    temperature: v.LLM_TEMPERATURE,
    maxOutputTokens: v.LLM_MAX_OUTPUT_TOKENS,
    timeoutMs: v.LLM_TIMEOUT_MS,
    maxRetries: v.LLM_MAX_RETRIES,
    pricing,
  };
  return v.LLM_PROVIDER === 'openai'
    ? {
        provider: 'openai',
        apiKey: v.OPENAI_API_KEY,
        model: v.OPENAI_MODEL,
        ...(v.OPENAI_BASE_URL ? { baseUrl: v.OPENAI_BASE_URL } : {}),
        ...common,
      }
    : {
        provider: 'azure-openai',
        apiKey: v.AZURE_OPENAI_API_KEY,
        endpoint: v.AZURE_OPENAI_ENDPOINT,
        deployment: v.AZURE_OPENAI_DEPLOYMENT,
        apiVersion: v.AZURE_OPENAI_API_VERSION,
        model: v.AZURE_OPENAI_MODEL ?? v.AZURE_OPENAI_DEPLOYMENT,
        ...common,
      };
}

function parseAuth(env: Env, issues: string[]): AuthConfig | undefined {
  const result = AuthEnv.safeParse({ ...env, AUTH_MODE: env.AUTH_MODE ?? 'api-key' });
  if (!result.success) {
    issues.push(...issuesOf(result.error));
    return undefined;
  }
  const v = result.data;
  if (v.AUTH_MODE === 'api-key') return { mode: 'api-key', apiKeys: v.API_KEYS };
  const algorithms = csv(v.JWT_ALGORITHMS);
  if (algorithms.some((a) => a.toLowerCase() === 'none'))
    issues.push('JWT_ALGORITHMS: "none" is not allowed');
  return {
    mode: 'jwt',
    issuer: v.JWT_ISSUER,
    audience: v.JWT_AUDIENCE,
    ...(v.JWT_JWKS_URL ? { jwksUrl: v.JWT_JWKS_URL } : {}),
    ...(v.JWT_SECRET ? { secret: v.JWT_SECRET } : {}),
    algorithms: algorithms.length ? algorithms : v.JWT_SECRET ? ['HS256'] : ['RS256', 'ES256'],
    tenantClaim: v.JWT_TENANT_CLAIM,
  };
}

/** Loads and validates the whole configuration. Throws {@link ConfigError} listing every problem at once. */
export function loadConfig(env: Env = process.env): AppConfig {
  const issues: string[] = [];
  const core = CoreEnv.safeParse(env);
  if (!core.success) issues.push(...issuesOf(core.error));
  const auth = parseAuth(env, issues);
  const llm = parseLlm(env, issues);
  if (core.success && core.data.OTEL_ENABLED && !core.data.OTEL_EXPORTER_OTLP_ENDPOINT)
    issues.push('OTEL_EXPORTER_OTLP_ENDPOINT: required when OTEL_ENABLED=true');
  if (!core.success || !auth || !llm || issues.length) throw new ConfigError(issues);

  const c = core.data;
  return Object.freeze({
    env: c.NODE_ENV,
    host: c.HOST,
    port: c.PORT,
    database: {
      url: c.DATABASE_URL,
      schema: c.DB_SCHEMA,
      poolMax: c.DB_POOL_MAX,
      autoMigrate: c.DB_AUTO_MIGRATE,
    },
    http: { corsOrigins: c.CORS_ORIGINS, bodyLimit: c.BODY_LIMIT, maxMessageChars: c.MAX_MESSAGE_CHARS },
    auth,
    llm,
    agent: { maxSteps: c.AGENT_MAX_STEPS, emailAllowedDomains: c.SEND_EMAIL_ALLOWED_DOMAINS },
    limits: {
      ratePerMinute: c.RATE_LIMIT_PER_MINUTE,
      burst: c.RATE_LIMIT_BURST,
      monthlyTokenBudget: c.TENANT_MONTHLY_TOKEN_BUDGET,
    },
    otel: {
      enabled: c.OTEL_ENABLED,
      ...(c.OTEL_EXPORTER_OTLP_ENDPOINT ? { endpoint: c.OTEL_EXPORTER_OTLP_ENDPOINT } : {}),
      serviceName: c.OTEL_SERVICE_NAME,
      captureContent: c.OTEL_CAPTURE_CONTENT,
    },
  });
}
