import { BadRequestException } from '@nestjs/common';
import type { z } from 'zod';

/** Parses a request body. The error lists paths and rules only, never the submitted values. */
export function parseBody<S extends z.ZodType>(schema: S, body: unknown): z.output<S> {
  const result = schema.safeParse(body);
  if (result.success) return result.data;
  throw new BadRequestException(
    result.error.issues.slice(0, 10).map((i) => `${i.path.join('.') || 'body'}: ${i.message}`),
  );
}
