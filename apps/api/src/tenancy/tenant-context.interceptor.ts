import { type CallHandler, type ExecutionContext, Injectable, type NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import type { AppRequest } from '../common/http.js';
import { TenantContext } from './tenant-context.js';

/** Runs the handler inside `TenantContext` so services can call `TenantContext.require()`. */
@Injectable()
export class TenantContextInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const tenant = context.switchToHttp().getRequest<AppRequest>().tenant;
    if (!tenant) return next.handle();
    return new Observable((subscriber) =>
      TenantContext.run(tenant, () => next.handle().subscribe(subscriber)),
    );
  }
}
