import { type ArgumentsHost, Catch, type ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import type { Response } from 'express';

/**
 * Every error leaves the API as `{ statusCode, message }`. Unknown errors become a generic 500 and are logged
 * server-side: stack traces, SQL errors and provider messages never reach the client.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Exceptions');

  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    let status = 500;
    let message: string | string[] = 'Internal server error';

    if (exception instanceof HttpException && exception.getStatus() < 500) {
      status = exception.getStatus();
      const body = exception.getResponse();
      message =
        typeof body === 'string'
          ? body
          : ((body as { message?: string | string[] }).message ?? exception.message);
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      message = status === 503 ? 'Service unavailable' : 'Internal server error';
    } else {
      this.logger.error(
        exception instanceof Error ? (exception.stack ?? exception.message) : String(exception),
      );
    }

    // Streaming responses (SSE) may have started already: just close them.
    if (res.headersSent) {
      if (!res.writableEnded) res.end();
      return;
    }
    res.status(status).json({ statusCode: status, message });
  }
}
