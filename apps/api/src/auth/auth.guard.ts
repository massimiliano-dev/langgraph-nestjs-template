import {
  type CanActivate,
  type ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';
import type { AppConfig } from '../config/config.js';
import type { AppRequest, Principal } from '../common/http.js';
import { IS_PUBLIC } from '../common/public.decorator.js';
import { APP_CONFIG } from '../common/tokens.js';
import { TENANT_ID_PATTERN } from '../tenancy/tenant-context.js';
import { ApiKeyVerifier } from './api-keys.js';

const BEARER = /^Bearer ([A-Za-z0-9._~+/=-]{16,4096})$/;

/**
 * Authentication placeholder that is safe to run as is:
 * - `AUTH_MODE=api-key`: service-to-service keys (the Next.js server uses one). Constant-time comparison.
 *   A key holder is trusted to assert the tenant with `x-tenant-id`: give keys only to your own backends.
 * - `AUTH_MODE=jwt`: verifies signature, issuer, audience and expiry with `jose`; the tenant comes from a
 *   claim and cannot be overridden by a header.
 * Applied globally, including the SSE endpoints. Only routes marked `@Public()` skip it.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  private readonly apiKeys?: ApiKeyVerifier;
  private readonly jwtKey?: JWTVerifyGetKey | Uint8Array;

  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {
    const auth = config.auth;
    if (auth.mode === 'api-key') this.apiKeys = new ApiKeyVerifier(auth.apiKeys);
    else
      this.jwtKey = auth.jwksUrl
        ? createRemoteJWKSet(new URL(auth.jwksUrl), { timeoutDuration: 5_000, cooldownDuration: 30_000 })
        : new TextEncoder().encode(auth.secret);
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [context.getHandler(), context.getClass()]))
      return true;
    const req = context.switchToHttp().getRequest<AppRequest>();
    const token = BEARER.exec(req.headers.authorization ?? '')?.[1];
    if (!token) throw this.unauthorized(req);
    const principal = await this.authenticate(token);
    if (!principal) throw this.unauthorized(req);
    req.principal = principal;
    return true;
  }

  private async authenticate(token: string): Promise<Principal | null> {
    const auth = this.config.auth;
    if (auth.mode === 'api-key') {
      const fingerprint = this.apiKeys!.verify(token);
      return fingerprint ? { kind: 'service', subject: `api-key:${fingerprint}` } : null;
    }
    try {
      const options = {
        issuer: auth.issuer,
        audience: auth.audience,
        algorithms: auth.algorithms,
        requiredClaims: ['exp', 'sub'],
        clockTolerance: 5,
      };
      const { payload } =
        this.jwtKey instanceof Uint8Array
          ? await jwtVerify(token, this.jwtKey, options)
          : await jwtVerify(token, this.jwtKey!, options);
      const tenantId = payload[auth.tenantClaim];
      if (typeof tenantId !== 'string' || !TENANT_ID_PATTERN.test(tenantId) || !payload.sub) return null;
      return { kind: 'user', subject: payload.sub, tenantId };
    } catch {
      return null;
    }
  }

  private unauthorized(req: AppRequest): UnauthorizedException {
    req.res?.setHeader('WWW-Authenticate', 'Bearer');
    return new UnauthorizedException('Unauthorized');
  }
}
