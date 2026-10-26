/** Explicit DI tokens: NestJS 12 is ESM-only and this project does not rely on emitted decorator metadata. */
export const APP_CONFIG = Symbol('APP_CONFIG');
export const THREADS_REPOSITORY = Symbol('THREADS_REPOSITORY');
export const USAGE_STORE = Symbol('USAGE_STORE');
export const RATE_LIMITER = Symbol('RATE_LIMITER');
export const RUN_LOCK = Symbol('RUN_LOCK');
export const AGENT_RUNNER = Symbol('AGENT_RUNNER');
export const TOOLS = Symbol('TOOLS');
export const HEALTH_CHECK = Symbol('HEALTH_CHECK');
