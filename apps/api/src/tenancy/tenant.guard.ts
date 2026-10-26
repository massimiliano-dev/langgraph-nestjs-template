import {
  BadRequestException,
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { AppRequest } from '../common/http.js';
import { IS_PUBLIC } from '../common/public.decorator.js';
import { TENANT_ID_PATTERN } from './tenant-context.js';

/**
 * Resolves the tenant for an authenticated request. Runs after {@link AuthGuard}.
 * - User tokens (JWT): the tenant is the verified claim. A different `x-tenant-id` header is refused.
 * - Service keys: the trusted caller asserts the tenant with `x-tenant-id`.
 * The value is validated against a strict pattern; it is then bound to AsyncLocalStorage by
 * {@link TenantContextInterceptor}.
 */
@Injectable()
export class TenantGuard implements CanActivate {
  constructor(@Inject(Reflector) private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [context.getHandler(), context.getClass()]))
      return true;
    const req = context.switchToHttp().getRequest<AppRequest>();
    const header = req.headers['x-tenant-id'];
    if (Array.isArray(header)) throw new BadRequestException('Invalid x-tenant-id header');
    if (header !== undefined && !TENANT_ID_PATTERN.test(header))
      throw new BadRequestException('Invalid x-tenant-id header');

    const principal = req.principal;
    if (!principal) throw new ForbiddenException('Forbidden');
    if (principal.kind === 'user') {
      if (header !== undefined && header !== principal.tenantId) throw new ForbiddenException('Forbidden');
      req.tenant = { id: principal.tenantId };
      return true;
    }
    if (header === undefined) throw new BadRequestException('Missing x-tenant-id header');
    req.tenant = { id: header };
    return true;
  }
}
