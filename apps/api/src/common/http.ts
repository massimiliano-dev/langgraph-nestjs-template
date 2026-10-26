import type { Request } from 'express';
import type { TenantInfo } from '../tenancy/tenant-context.js';

export type Principal =
  { kind: 'service'; subject: string } | { kind: 'user'; subject: string; tenantId: string };

export type AppRequest = Request & { principal?: Principal; tenant?: TenantInfo };
