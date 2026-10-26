import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC = 'app:isPublic';

/** Skips authentication and tenant resolution. Use only for endpoints that return no tenant data. */
export const Public = () => SetMetadata(IS_PUBLIC, true);
