import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { createChatModel } from './agent/llm.js';
import { AppModule } from './app.module.js';
import { configureApp } from './bootstrap.js';
import { ConfigError, loadConfig } from './config/config.js';
import { createCheckpointer, createPool, migrate } from './database/database.js';
import { startTelemetry } from './observability/telemetry.js';
import { InMemoryTokenBucket } from './tenancy/rate-limiter.js';
import { PgAdvisoryRunLock } from './tenancy/run-lock.js';
import { PgUsageStore } from './tenancy/usage-store.js';
import { PgThreadsRepository } from './threads/threads.repository.js';

const logger = new Logger('Bootstrap');

async function bootstrap() {
  const config = loadConfig();
  const stopTelemetry = startTelemetry(config.otel);
  if (/^(true|1)$/i.test(process.env.LANGSMITH_TRACING ?? process.env.LANGCHAIN_TRACING_V2 ?? ''))
    logger.warn('LangSmith tracing is ON: prompts, tool arguments and outputs are sent to LangSmith.');

  const pool = createPool(config.database);
  const checkpointer = createCheckpointer(pool, config.database.schema);
  if (config.database.autoMigrate) await migrate(pool, checkpointer, config.database.schema);

  const app = await NestFactory.create(
    AppModule.forRoot(config, {
      model: createChatModel(config.llm),
      checkpointer,
      threads: new PgThreadsRepository(pool, config.database.schema),
      usage: new PgUsageStore(pool, config.database.schema),
      rateLimiter: new InMemoryTokenBucket({
        perMinute: config.limits.ratePerMinute,
        burst: config.limits.burst,
      }),
      runLock: new PgAdvisoryRunLock(pool),
      healthCheck: async () => void (await pool.query('SELECT 1')),
    }),
    { bodyParser: false, logger: ['log', 'warn', 'error'] },
  );
  configureApp(app, config);
  app.enableShutdownHooks();

  let closing = false;
  const shutdown = async () => {
    if (closing) return;
    closing = true;
    await app.close();
    await pool.end();
    await stopTelemetry();
  };
  process.once('SIGTERM', () => void shutdown());
  process.once('SIGINT', () => void shutdown());

  await app.listen(config.port, config.host);
  logger.log(
    `API listening on ${config.host}:${config.port} (auth=${config.auth.mode}, llm=${config.llm.provider})`,
  );
}

bootstrap().catch((error: unknown) => {
  // Config errors list variable names only. Other errors may contain connection details: print the name only.
  if (error instanceof ConfigError) console.error(error.message);
  else
    console.error(
      `Startup failed: ${error instanceof Error ? `${error.name}: ${error.message}` : 'unknown'}`,
    );
  process.exit(1);
});
