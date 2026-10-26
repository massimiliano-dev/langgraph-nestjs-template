import {
  type CanActivate,
  type ExecutionContext,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
} from '@nestjs/common';
import type { AppRequest } from '../common/http.js';
import { RATE_LIMITER } from '../common/tokens.js';
import type { RateLimiter } from './rate-limiter.js';

/** Per-tenant request rate limit. Responds 429 with `Retry-After`. */
@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(@Inject(RATE_LIMITER) private readonly limiter: RateLimiter) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AppRequest>();
    if (!req.tenant) return true;
    const result = await this.limiter.consume(`tenant:${req.tenant.id}`);
    if (result.allowed) return true;
    req.res?.setHeader('Retry-After', String(result.retryAfterSeconds));
    throw new HttpException('Too many requests', HttpStatus.TOO_MANY_REQUESTS);
  }
}
