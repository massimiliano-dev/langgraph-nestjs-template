import type { INestApplication } from '@nestjs/common';
import express, { type NextFunction, type Request, type Response } from 'express';
import helmet from 'helmet';
import type { AppConfig } from './config/config.js';

/**
 * HTTP hardening shared by `main.ts` and the tests, so tests exercise the real configuration.
 * Create the app with `{ bodyParser: false }`: the JSON parser is registered here with a size limit.
 */
export function configureApp(app: INestApplication, config: AppConfig): void {
  app.use(helmet());
  // JSON only, small bodies. Parser errors are answered here, before Express' default handler could print them.
  const json = express.json({ limit: config.http.bodyLimit, strict: true });
  app.use((req: Request, res: Response, next: NextFunction) =>
    json(req, res, (error?: unknown) => {
      if (!error) return next();
      const status = (error as { status?: number }).status === 413 ? 413 : 400;
      res
        .status(status)
        .json({ statusCode: status, message: status === 413 ? 'Payload too large' : 'Invalid JSON' });
    }),
  );
  if (config.http.corsOrigins.length) {
    app.enableCors({
      origin: config.http.corsOrigins,
      methods: ['GET', 'POST'],
      allowedHeaders: ['authorization', 'content-type', 'x-tenant-id'],
      credentials: false,
      maxAge: 600,
    });
  }
}
