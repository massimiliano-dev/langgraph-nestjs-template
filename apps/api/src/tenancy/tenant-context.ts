import { AsyncLocalStorage } from 'node:async_hooks';

export interface TenantInfo {
  id: string;
}

/** Tenant ids are opaque slugs. Anything else is rejected before it reaches storage, logs or spans. */
export const TENANT_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,62}$/;

const storage = new AsyncLocalStorage<TenantInfo>();

/**
 * The current tenant for the request, carried with AsyncLocalStorage (no request-scoped providers).
 *
 * This is a placeholder for `@massimiliano-dev/nestjs-prisma-tenants`, which resolves tenants from a registry
 * (subdomain, header or verified JWT claim) and exposes the same "current tenant" concept. See the README.
 */
export const TenantContext = {
  run<T>(tenant: TenantInfo, fn: () => T): T {
    return storage.run(tenant, fn);
  },
  current(): TenantInfo | undefined {
    return storage.getStore();
  },
  /** Throws when called outside a tenant-scoped request: fail closed rather than guess a tenant. */
  require(): TenantInfo {
    const tenant = storage.getStore();
    if (!tenant) throw new Error('No tenant in context');
    return tenant;
  },
};
